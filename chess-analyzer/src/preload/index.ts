import { contextBridge, ipcRenderer } from 'electron';
import type {
  EngineBuild,
  EngineOptions,
  Puzzle,
  PuzzlePoolStatus,
  PuzzleProgress,
  StoredGame,
} from '../shared/types';

const api = {
  engine: {
    send: (cmd: string): void => ipcRenderer.send('engine:send', cmd),
    /** Subscribe to raw UCI output lines. Returns an unsubscribe function. */
    onLine: (cb: (line: string) => void): (() => void) => {
      const handler = (_e: unknown, line: string): void => cb(line);
      ipcRenderer.on('engine:line', handler);
      return () => ipcRenderer.removeListener('engine:line', handler);
    },
    onExit: (cb: (info: { code: number | null; stderr: string }) => void): (() => void) => {
      const handler = (_e: unknown, info: { code: number | null; stderr: string }): void => cb(info);
      ipcRenderer.on('engine:exit', handler);
      return () => ipcRenderer.removeListener('engine:exit', handler);
    },
    /** Fired just before the engine process is deliberately replaced. */
    onReset: (cb: () => void): (() => void) => {
      const handler = (): void => cb();
      ipcRenderer.on('engine:reset', handler);
      return () => ipcRenderer.removeListener('engine:reset', handler);
    },
    restart: (build: EngineBuild) => ipcRenderer.invoke('engine:restart', build),
    status: () => ipcRenderer.invoke('engine:status'),
  },
  settings: {
    get: (): Promise<EngineOptions> => ipcRenderer.invoke('settings:get'),
    set: (next: EngineOptions): Promise<EngineOptions> => ipcRenderer.invoke('settings:set', next),
  },
  library: {
    list: (): Promise<StoredGame[]> => ipcRenderer.invoke('library:list'),
    save: (games: StoredGame[]): Promise<boolean> => ipcRenderer.invoke('library:save', games),
  },
  cache: {
    get: <T>(key: string): Promise<T | null> => ipcRenderer.invoke('cache:get', key),
    set: (key: string, value: unknown): Promise<boolean> => ipcRenderer.invoke('cache:set', key, value),
  },
  net: {
    fetchText: (url: string, accept?: string): Promise<string> =>
      ipcRenderer.invoke('net:fetch', url, accept),
  },
  puzzles: {
    status: (): Promise<PuzzlePoolStatus> => ipcRenderer.invoke('puzzles:status'),
    list: (theme: string): Promise<Puzzle[]> => ipcRenderer.invoke('puzzles:list', theme),
    import: (): Promise<PuzzlePoolStatus> => ipcRenderer.invoke('puzzles:import'),
    onImported: (cb: (status: PuzzlePoolStatus) => void): (() => void) => {
      const handler = (_e: unknown, status: PuzzlePoolStatus): void => cb(status);
      ipcRenderer.on('puzzles:imported', handler);
      return () => ipcRenderer.removeListener('puzzles:imported', handler);
    },
  },
  progress: {
    get: (): Promise<PuzzleProgress> => ipcRenderer.invoke('progress:get'),
    set: (next: PuzzleProgress): Promise<PuzzleProgress> => ipcRenderer.invoke('progress:set', next),
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
