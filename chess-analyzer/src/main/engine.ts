import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { ENGINE_BUILD_FILES, type EngineBuild } from '../shared/types';

/**
 * Owns the Stockfish child process.
 *
 * The engine is spawned as a bare Node process (ELECTRON_RUN_AS_NODE) running
 * resources/engine-host.cjs, which loads the WASM engine and relays stdin->UCI.
 * Engine replies arrive on the child's stdout.
 */
export class EngineProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuf = '';
  private stderrBuf = '';
  private listeners = new Set<(line: string) => void>();
  private exitListeners = new Set<(info: { code: number | null; stderr: string }) => void>();
  /**
   * Children we deliberately shut down. Their `exit` must not be reported as an
   * engine crash: by the time it arrives a replacement is already running, and
   * treating it as a crash would tear down the *new* engine's in-flight search.
   */
  private retired = new WeakSet<object>();

  build: EngineBuild = 'lite-single';

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  onLine(fn: (line: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onExit(fn: (info: { code: number | null; stderr: string }) => void): () => void {
    this.exitListeners.add(fn);
    return () => this.exitListeners.delete(fn);
  }

  /** Absolute path (no extension) to the engine build's files. */
  private enginePath(build: EngineBuild): string {
    const dir = app.isPackaged
      ? join(process.resourcesPath, 'engine')
      : join(app.getAppPath(), 'resources', 'engine');
    return join(dir, ENGINE_BUILD_FILES[build]);
  }

  private hostPath(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'engine-host.cjs')
      : join(app.getAppPath(), 'resources', 'engine-host.cjs');
  }

  /** Throws with an actionable message if the requested build isn't on disk. */
  assertAvailable(build: EngineBuild): void {
    const base = this.enginePath(build);
    for (const ext of ['.js', '.wasm']) {
      if (!existsSync(base + ext)) {
        throw new Error(
          build === 'single'
            ? 'The full 108 MB engine is not installed. Run `npm run engine:full` to add it.'
            : `Engine files missing: ${base + ext}`,
        );
      }
    }
  }

  isAvailable(build: EngineBuild): boolean {
    try {
      this.assertAvailable(build);
      return true;
    } catch {
      return false;
    }
  }

  start(build: EngineBuild): void {
    this.stop();
    this.assertAvailable(build);
    this.build = build;

    const child = spawn(process.execPath, [this.hostPath(), this.enginePath(build)], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;

    this.child = child;
    this.stdoutBuf = '';
    this.stderrBuf = '';

    // Engine output arrives in arbitrary chunks; a UCI line can be split
    // mid-token. Keep the trailing partial line in the buffer.
    child.stdout.on('data', (chunk: Buffer) => {
      this.stdoutBuf += chunk.toString('utf8');
      const parts = this.stdoutBuf.split('\n');
      this.stdoutBuf = parts.pop() ?? '';
      for (const raw of parts) {
        const line = raw.trim();
        if (line) for (const fn of this.listeners) fn(line);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      this.stderrBuf = (this.stderrBuf + chunk.toString('utf8')).slice(-4000);
    });

    child.on('exit', (code) => {
      const retired = this.retired.has(child);
      if (this.child === child) this.child = null;
      // Only an unexpected death is an "exit" worth reacting to.
      if (!retired) for (const fn of this.exitListeners) fn({ code, stderr: this.stderrBuf });
    });

    // Handshake + persistent options.
    this.send('uci');
    this.send('isready');
  }

  send(cmd: string): void {
    if (!this.child || this.child.exitCode !== null) return;
    this.child.stdin.write(cmd + '\n');
  }

  stop(): void {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    this.retired.add(child);
    try {
      child.stdin.write('quit\n');
    } catch {
      /* already gone */
    }
    // Don't wait around; the engine is stateless to us at this point.
    setTimeout(() => {
      if (child.exitCode === null) child.kill();
    }, 300);
  }
}
