import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, net, session, shell } from 'electron';
import { EngineProcess } from './engine';
import { PuzzleLibrary } from './puzzles';
import { JsonStore } from './store';
import {
  DEFAULT_ENGINE_OPTIONS,
  DEFAULT_PROGRESS,
  type EngineBuild,
  type EngineOptions,
  type PuzzleProgress,
} from '../shared/types';

const engine = new EngineProcess();
let settings: JsonStore;
let library: JsonStore;
let cache: JsonStore;
let progressStore: JsonStore;
let puzzles: PuzzleLibrary;
let win: BrowserWindow | null = null;

/** Only these hosts may be fetched on the renderer's behalf. */
const ALLOWED_HOSTS = new Set(['api.chess.com', 'lichess.org']);

/** Reviews kept on disk before the oldest are evicted. */
const MAX_CACHED_REVIEWS = 50;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1420,
    height: 940,
    minWidth: 1040,
    minHeight: 720,
    show: false,
    backgroundColor: '#161512',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.on('ready-to-show', () => win?.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // The verification harness is signalled through the renderer URL. Neither
  // process.env nor webPreferences.additionalArguments reach the preload
  // reliably in a packaged build; the page's own location always does.
  const query = process.env['CHESS_SHOT'] ? { testhook: '1' } : undefined;

  if (process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL']);
    if (query) url.searchParams.set('testhook', '1');
    void win.loadURL(url.toString());
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query });
  }

  if (process.env['CHESS_SHOT']) void runScreenshot(win);
}

/**
 * Headless verification hook: drive the UI, capture the window, exit.
 * Enabled only when CHESS_SHOT is set to an output path.
 *
 * capturePage() is used instead of an OS-level grab because Windows'
 * PrintWindow() returns a blank bitmap for GPU-composited Chromium windows.
 *
 *   CHESS_SHOT=out.png CHESS_SHOT_MOVES="e4,e5,Nf3" npx electron .
 */
async function runScreenshot(target: BrowserWindow): Promise<void> {
  const out = process.env['CHESS_SHOT'] as string;
  const moves = (process.env['CHESS_SHOT_MOVES'] ?? '').split(',').filter(Boolean);
  const scriptPath = process.env['CHESS_SHOT_SCRIPT'];

  await new Promise<void>((res) => target.webContents.once('did-finish-load', () => res()));

  // Hard-offline the renderer via CDP, to prove the engine, openings, grading
  // and cached reviews need no network at all.
  if (process.env['CHESS_SHOT_OFFLINE']) {
    // net.fetch runs through the session, so a dead proxy takes the whole app
    // offline -- main included, not just the renderer.
    await session.defaultSession.setProxy({ proxyRules: 'http=127.0.0.1:1;https=127.0.0.1:1' });
    await target.webContents.executeJavaScript(
      `Object.defineProperty(navigator, 'onLine', { get: () => false });`,
    );
    console.log('[shot] forced offline (dead proxy + navigator.onLine=false)');
  }

  // Let the engine hand-shake and the ECO index build.
  await new Promise((r) => setTimeout(r, 4000));

  // An arbitrary async script evaluated in the renderer; its resolved value is
  // printed. Used to exercise import and review without a GUI.
  if (scriptPath) {
    try {
      const src = readFileSync(scriptPath, 'utf8');
      const result = await target.webContents.executeJavaScript(src);
      console.log('[shot] SCRIPT ' + JSON.stringify(result));
    } catch (err) {
      console.log('[shot] SCRIPT_ERROR ' + JSON.stringify(String((err as Error).message)));
    }
  }

  if (moves.length) {
    const result = await target.webContents.executeJavaScript(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (const san of ${JSON.stringify(moves)}) {
        if (!window.__playSan) return 'test hook missing';
        window.__playSan(san);
        await sleep(1200);   // deliberately faster than a full-depth search
      }
      return 'ok';
    })()`);
    console.log('[shot] moves:', result);
  }

  await new Promise((r) => setTimeout(r, 4000));

  const summary = await target.webContents.executeJavaScript(`(() => {
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
    return {
      opening: text('.opening-name'),
      eco: text('.eco-badge'),
      evalReadout: text('.eval-readout'),
      gradeTitle: text('.grade-title'),
      commentary: text('.grade-text'),
      engineDepth: text('.analysis-panel .panel-head .muted'),
      topLine: text('.line-row .line-pv'),
      moves: [...document.querySelectorAll('.move-cell:not(.empty)')].map((b) => b.textContent.trim()),
    };
  })()`);
  console.log('[shot] STATE ' + JSON.stringify(summary));

  const image = await target.webContents.capturePage();
  writeFileSync(out, image.toPNG());
  console.log('[shot] wrote', out);
  app.quit();
}

function startEngine(build: EngineBuild): void {
  // Tell the renderer to abandon its queue *before* the swap. The outgoing
  // engine's `bestmove` will never arrive, and its exit is deliberately silent,
  // so this is the only signal that the in-flight search is dead.
  win?.webContents.send('engine:reset');
  engine.start(build);
  const opts = settings.get<EngineOptions>('engine', DEFAULT_ENGINE_OPTIONS);
  engine.send(`setoption name Hash value ${opts.hashMb}`);
  engine.send(`setoption name MultiPV value ${opts.multipv}`);
  engine.send('isready');
}

app.whenReady().then(() => {
  settings = new JsonStore('settings.json');
  library = new JsonStore('library.json');
  cache = new JsonStore('analysis-cache.json');
  progressStore = new JsonStore('progress.json');
  puzzles = new PuzzleLibrary(new JsonStore('puzzles.json'));

  // Relay every engine line to the renderer, which owns UCI parsing.
  engine.onLine((line) => win?.webContents.send('engine:line', line));
  engine.onExit(({ code, stderr }) =>
    win?.webContents.send('engine:exit', { code, stderr }),
  );

  const opts = settings.get<EngineOptions>('engine', DEFAULT_ENGINE_OPTIONS);
  try {
    startEngine(opts.build);
  } catch (err) {
    // A missing full-net build shouldn't prevent the app from opening.
    startEngine('lite-single');
    console.error('[engine] falling back to lite-single:', (err as Error).message);
  }

  ipcMain.on('engine:send', (_e, cmd: string) => engine.send(String(cmd)));

  ipcMain.handle('engine:restart', (_e, build: EngineBuild) => {
    engine.assertAvailable(build);
    startEngine(build);
    return { build };
  });

  ipcMain.handle('engine:status', () => ({
    running: engine.running,
    build: engine.build,
    packaged: app.isPackaged,
    available: {
      'lite-single': engine.isAvailable('lite-single'),
      single: engine.isAvailable('single'),
    },
  }));

  ipcMain.handle('settings:get', () => settings.get<EngineOptions>('engine', DEFAULT_ENGINE_OPTIONS));
  ipcMain.handle('settings:set', (_e, next: EngineOptions) => {
    settings.set('engine', next);
    engine.send(`setoption name Hash value ${next.hashMb}`);
    engine.send(`setoption name MultiPV value ${next.multipv}`);
    return next;
  });

  ipcMain.handle('library:list', () => library.get<unknown[]>('games', []));
  ipcMain.handle('library:save', (_e, games: unknown[]) => {
    library.set('games', games);
    return true;
  });

  ipcMain.handle('cache:get', (_e, key: string) => cache.get<unknown>(key, null));
  ipcMain.handle('cache:set', (_e, key: string, value: unknown) => {
    // A full review is tens of KB and the store rewrites the whole file on each
    // write. Evict oldest-first (object key order is insertion order) so the
    // cache can't grow without bound.
    const keys = cache.keys();
    for (const stale of keys.slice(0, Math.max(0, keys.length + 1 - MAX_CACHED_REVIEWS))) {
      cache.delete(stale);
    }
    cache.set(key, value);
    return true;
  });

  /**
   * Fetch proxy. Doing this in main sidesteps renderer CORS/origin questions
   * entirely and lets us allowlist hosts.
   */
  ipcMain.handle('net:fetch', async (_e, url: string, accept?: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Invalid URL');
    }
    if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
      throw new Error(`Blocked host: ${parsed.hostname}`);
    }
    // Electron's net.fetch (not Node's global fetch) so requests honour the
    // session's proxy and offline state.
    const res = await net.fetch(parsed.toString(), {
      headers: {
        Accept: accept ?? 'application/json',
        'User-Agent': 'ChessAnalyzer/0.1 (desktop app)',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${parsed.hostname}`);
    return await res.text();
  });

  // ---- puzzles ----------------------------------------------------------
  ipcMain.handle('puzzles:status', () => puzzles.status());
  ipcMain.handle('puzzles:list', (_e, theme: string) => puzzles.list(String(theme)));
  ipcMain.handle('puzzles:import', async () => {
    const status = await puzzles.importNow();
    win?.webContents.send('puzzles:imported', status);
    return status;
  });

  ipcMain.handle('progress:get', () => progressStore.get<PuzzleProgress>('progress', DEFAULT_PROGRESS));
  ipcMain.handle('progress:set', (_e, next: PuzzleProgress) => {
    progressStore.set('progress', next);
    return next;
  });

  createWindow();

  // A day since the last import (or never) -> refresh in the background. The
  // window is already up; puzzle mode serves from the existing pool meanwhile.
  if (puzzles.needsDailyImport()) {
    void puzzles.importNow().then((status) => win?.webContents.send('puzzles:imported', status));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  engine.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => engine.stop());
