import type { InfoLine, PositionEval } from '@shared/types';
import { parseBestMove, parseInfo } from './uci';

interface Search {
  fen: string;
  depth: number;
  multipv: number;
  lines: Map<number, InfoLine>;
  onUpdate?: (partial: PositionEval) => void;
  settle: (result: PositionEval) => void;
}

function emptyEval(fen: string): PositionEval {
  return { fen, depth: 0, lines: [] };
}

/**
 * Serializes access to the single engine process.
 *
 * Stockfish runs one search at a time; issuing `go` while a search is running
 * corrupts results. A new request therefore sends `stop` and waits for the
 * terminating `bestmove` before starting.
 *
 * Superseded searches always settle -- with whatever partial data they had, or
 * an empty result if they never started. Callers must check `result.fen` before
 * using it, since a superseded search resolves for a position you may have left.
 */
export class EngineClient {
  private current: Search | null = null;
  private pending: Search | null = null;
  private ready = false;
  private readyWaiters: Array<() => void> = [];
  private readyPoll: number | null = null;
  private unsubscribe: () => void;
  private unsubscribeExit: () => void;
  private unsubscribeReset: () => void;

  constructor() {
    this.unsubscribe = window.api.engine.onLine((line) => this.handleLine(line));
    // Switching engine builds kills the process mid-search. Its `bestmove` will
    // never arrive, so settle everything or the queue deadlocks forever.
    // `engine:reset` precedes a deliberate swap; `engine:exit` means a crash.
    this.unsubscribeReset = window.api.engine.onReset(() => this.reset());
    this.unsubscribeExit = window.api.engine.onExit(() => this.reset());
    window.api.engine.send('isready');
  }

  /** Abandon all in-flight work. Awaiters settle with whatever partial data exists. */
  private reset(): void {
    const { current, pending } = this;
    this.current = null;
    this.pending = null;
    this.ready = false;
    current?.settle(this.snapshot(current));
    pending?.settle(emptyEval(pending.fen));
  }

  /**
   * Poll `isready` until the engine answers.
   *
   * Restarting an engine spawns the replacement before the old process's exit
   * event arrives, so a `readyok` from the new engine can land *before* the exit
   * clears `ready`. Waiting passively for a `readyok` that already happened
   * deadlocks the queue; asking again always terminates.
   */
  private ensureReady(): void {
    if (this.readyPoll !== null) return;
    window.api.engine.send('isready');
    this.readyPoll = window.setInterval(() => {
      if (this.ready) {
        this.clearReadyPoll();
        return;
      }
      window.api.engine.send('isready');
    }, 500);
  }

  private clearReadyPoll(): void {
    if (this.readyPoll !== null) {
      clearInterval(this.readyPoll);
      this.readyPoll = null;
    }
  }

  dispose(): void {
    this.unsubscribe();
    this.unsubscribeExit();
    this.unsubscribeReset();
    this.clearReadyPoll();
    this.reset();
  }

  private handleLine(line: string): void {
    if (line === 'readyok' || line === 'uciok') {
      this.ready = true;
      this.clearReadyPoll();
      this.readyWaiters.splice(0).forEach((fn) => fn());
      return;
    }

    const search = this.current;
    if (!search) return;

    const info = parseInfo(line);
    if (info) {
      // Keep only the deepest line seen per multipv slot.
      const prev = search.lines.get(info.multipv);
      if (!prev || info.depth >= prev.depth) search.lines.set(info.multipv, info);
      search.onUpdate?.(this.snapshot(search));
      return;
    }

    if (line.startsWith('bestmove')) {
      const best = parseBestMove(line);
      this.current = null;
      search.settle(this.snapshot(search, best ?? undefined));
      this.startPending();
    }
  }

  private snapshot(search: Search, bestMove?: string): PositionEval {
    const lines = [...search.lines.values()].sort((a, b) => a.multipv - b.multipv);
    return {
      fen: search.fen,
      depth: lines.length ? Math.max(...lines.map((l) => l.depth)) : 0,
      lines,
      bestMove: bestMove ?? lines[0]?.pv[0],
    };
  }

  private startPending(): void {
    const next = this.pending;
    if (!next) return;
    this.pending = null;
    this.current = next;
    window.api.engine.send(`setoption name MultiPV value ${next.multipv}`);
    window.api.engine.send(`position fen ${next.fen}`);
    window.api.engine.send(`go depth ${next.depth}`);
  }

  private waitReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((res) => {
      this.readyWaiters.push(res);
      this.ensureReady();
    });
  }

  /**
   * Analyse a position to a fixed depth, cancelling any in-flight search.
   * `onUpdate` streams partial results as the engine deepens.
   */
  async analyze(
    fen: string,
    opts: { depth: number; multipv: number; onUpdate?: (p: PositionEval) => void },
  ): Promise<PositionEval> {
    await this.waitReady();

    return new Promise<PositionEval>((resolve) => {
      const search: Search = {
        fen,
        depth: opts.depth,
        multipv: opts.multipv,
        lines: new Map(),
        onUpdate: opts.onUpdate,
        settle: resolve,
      };

      // A queued-but-unstarted search is dropped; settle it so its awaiter
      // doesn't hang forever.
      if (this.pending) {
        const dropped = this.pending;
        dropped.settle(emptyEval(dropped.fen));
      }
      this.pending = search;

      if (this.current) {
        // `bestmove` from the stopped search will drain the queue.
        window.api.engine.send('stop');
      } else {
        this.startPending();
      }
    });
  }

  /** Stop any running search. Safe when idle. */
  stop(): void {
    if (this.current) window.api.engine.send('stop');
  }
}

let singleton: EngineClient | null = null;

export function getEngine(): EngineClient {
  if (!singleton) singleton = new EngineClient();
  return singleton;
}
