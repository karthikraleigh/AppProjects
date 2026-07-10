import zlib from 'node:zlib';
import { Chess } from 'chess.js';
import { net } from 'electron';
import type { Puzzle, PuzzlePoolStatus } from '../shared/types';
import { ALL_THEMES } from '../shared/tactics';
import type { JsonStore } from './store';

const DUMP_URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';
const DAILY_URL = 'https://lichess.org/api/puzzle/daily';

/**
 * The dump begins with a 12-byte zstd *skippable* frame; the real data frame
 * starts at byte 12. Node's decompressor yields nothing if fed from byte 0.
 * A second frame begins at ~216.5 MB — alternating between them widens the
 * pool of reachable puzzles.
 */
const FRAME_OFFSETS = [12, 227041731];

/** Compressed bytes to pull per import. ~5.7 MB decodes to ~119k rows. */
const SLICE_BYTES = 6_000_000;

/** Puzzles kept per theme. Beyond this we stop adding. */
const PER_THEME_CAP = 240;

/** Puzzles taken per theme on each import. */
const PER_THEME_BATCH = 40;

/** A puzzle needs at least this many plays to be worth serving. */
const MIN_PLAYS = 200;
/** ...and this much approval. */
const MIN_POPULARITY = 80;

const DAY_MS = 24 * 60 * 60 * 1000;

interface Row {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  popularity: number;
  plays: number;
  themes: string[];
  gameUrl: string;
}

/** Parse one CSV row. The dump has no quoted fields, so a plain split is safe. */
function parseRow(line: string): Row | null {
  const f = line.split(',');
  if (f.length < 9) return null;
  const rating = Number(f[3]);
  const popularity = Number(f[5]);
  const plays = Number(f[6]);
  if (!Number.isFinite(rating)) return null;
  return {
    id: f[0],
    fen: f[1],
    moves: f[2].split(' ').filter(Boolean),
    rating,
    popularity,
    plays,
    themes: (f[7] ?? '').split(' ').filter(Boolean),
    gameUrl: f[8] ?? '',
  };
}

/**
 * The dump's FEN is the position *before* the opponent's blunder reply, and
 * `Moves[0]` is that reply. The solver starts after it. (The API differs: there
 * the PGN already includes that move.)
 */
function toPuzzle(row: Row): Puzzle | null {
  if (row.moves.length < 2) return null;
  let game: Chess;
  try {
    game = new Chess(row.fen);
    const first = row.moves[0];
    game.move({ from: first.slice(0, 2), to: first.slice(2, 4), promotion: first.slice(4, 5) || undefined });
  } catch {
    return null;
  }
  return {
    id: row.id,
    fen: game.fen(),
    solution: row.moves.slice(1),
    rating: row.rating,
    themes: row.themes,
    gameUrl: row.gameUrl,
  };
}

/**
 * Stream-decode a bounded slice of the dump and hand each CSV line to `onRow`,
 * stopping as soon as `onRow` returns false. Truncating a zstd frame makes the
 * decoder error at the end; that is expected and not a failure.
 */
async function streamSlice(frameOffset: number, onRow: (line: string) => boolean): Promise<void> {
  const res = await net.fetch(DUMP_URL, {
    headers: { Range: `bytes=${frameOffset}-${frameOffset + SLICE_BYTES - 1}` },
  });
  // Insist on 206. A plain 200 means the server ignored Range and is about to
  // hand us the entire 288 MB dump, which arrayBuffer() would happily buffer.
  if (res.status !== 206) throw new Error(`dump: expected 206, got ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > SLICE_BYTES * 2) throw new Error(`dump: oversized slice (${buf.length} bytes)`);

  const dec = zlib.createZstdDecompress({
    params: { [zlib.constants.ZSTD_d_windowLogMax]: 31 },
  });

  await new Promise<void>((resolve) => {
    let tail = '';
    let stop = false;
    const finish = (): void => resolve();

    dec.on('data', (chunk: Buffer) => {
      if (stop) return;
      tail += chunk.toString('utf8');
      const parts = tail.split('\n');
      tail = parts.pop() ?? '';
      for (const line of parts) {
        if (!line) continue;
        if (!onRow(line)) {
          stop = true;
          dec.destroy();
          finish();
          return;
        }
      }
    });
    // A truncated frame ends in an error. That is how we bound the download.
    dec.on('error', finish);
    dec.on('end', finish);
    dec.end(buf);
  });
}

/** Fisher-Yates, so each import samples different puzzles from the slice. */
function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export class PuzzleLibrary {
  private importing = false;
  private lastError: string | undefined;

  constructor(private store: JsonStore) {}

  private pool(): Record<string, Puzzle> {
    return this.store.get<Record<string, Puzzle>>('pool', {});
  }

  private savePool(pool: Record<string, Puzzle>): void {
    this.store.set('pool', pool);
  }

  status(): PuzzlePoolStatus {
    const pool = this.pool();
    const byTheme: Record<string, number> = {};
    for (const theme of ALL_THEMES) byTheme[theme] = 0;
    for (const puzzle of Object.values(pool)) {
      for (const theme of puzzle.themes) {
        if (theme in byTheme) byTheme[theme] += 1;
      }
    }
    return {
      total: Object.keys(pool).length,
      byTheme,
      lastImport: this.store.get<number>('lastImport', 0),
      importing: this.importing,
      lastError: this.lastError,
    };
  }

  list(theme: string): Puzzle[] {
    return Object.values(this.pool()).filter((p) => p.themes.includes(theme));
  }

  get(id: string): Puzzle | null {
    return this.pool()[id] ?? null;
  }

  /** True when the last import was more than a day ago. */
  needsDailyImport(): boolean {
    return Date.now() - this.store.get<number>('lastImport', 0) > DAY_MS;
  }

  /** Lichess's official Puzzle of the Day. Cheap and not rate-limited. */
  private async importDaily(pool: Record<string, Puzzle>): Promise<void> {
    const res = await net.fetch(DAILY_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`daily HTTP ${res.status}`);
    const body = (await res.json()) as {
      game: { pgn: string };
      puzzle: { id: string; solution: string[]; rating: number; themes: string[]; initialPly: number };
    };

    // Unlike the dump, the API's PGN already ends at the puzzle position, and
    // solution[0] is the solver's move. Verified against initialPly + 1.
    const game = new Chess();
    game.loadPgn(body.game.pgn);

    // Clear any previous daily flag.
    for (const puzzle of Object.values(pool)) if (puzzle.daily) delete puzzle.daily;

    pool[body.puzzle.id] = {
      id: body.puzzle.id,
      fen: game.fen(),
      solution: body.puzzle.solution,
      rating: body.puzzle.rating,
      themes: body.puzzle.themes,
      gameUrl: `https://lichess.org/training/${body.puzzle.id}`,
      daily: true,
    };
  }

  /**
   * Pull a bounded slice of the dump and top each theme up to its cap.
   *
   * `/api/puzzle/next` is hard rate-limited (429 after a handful of calls, and
   * still 429 after a minute idle), so bulk import from the database dump is the
   * only workable source. One ~6 MB slice yields ~119k rows.
   */
  async importNow(): Promise<PuzzlePoolStatus> {
    if (this.importing) return this.status();
    this.importing = true;
    this.lastError = undefined;

    const pool = this.pool();

    try {
      try {
        await this.importDaily(pool);
      } catch (err) {
        // The daily puzzle is a bonus; a bulk import is still worth doing.
        this.lastError = `daily puzzle: ${(err as Error).message}`;
      }

      const counts: Record<string, number> = {};
      for (const theme of ALL_THEMES) counts[theme] = 0;
      for (const puzzle of Object.values(pool)) {
        for (const theme of puzzle.themes) if (theme in counts) counts[theme] += 1;
      }

      // Alternate frames day to day so the reachable universe is not always the
      // lowest-id puzzles.
      const frame = FRAME_OFFSETS[Math.floor(Date.now() / DAY_MS) % FRAME_OFFSETS.length];

      // Reservoir-sample per theme. Keeping the first N rows we happen to see
      // would bias every import toward the lowest puzzle ids, and a common theme
      // like mateIn1 has ~17k rows in a single slice — far too many to hold.
      const RESERVOIR = PER_THEME_BATCH * 6;
      const candidates: Record<string, Row[]> = {};
      const seenCount: Record<string, number> = {};
      for (const theme of ALL_THEMES) {
        candidates[theme] = [];
        seenCount[theme] = 0;
      }

      let header = true;
      await streamSlice(frame, (line) => {
        if (header) {
          header = false;
          return true;
        }
        const row = parseRow(line);
        if (!row) return true;
        if (row.plays < MIN_PLAYS || row.popularity < MIN_POPULARITY) return true;
        if (pool[row.id]) return true;

        for (const theme of row.themes) {
          if (!(theme in candidates) || counts[theme] >= PER_THEME_CAP) continue;
          const seen = (seenCount[theme] += 1);
          const bucket = candidates[theme];
          if (bucket.length < RESERVOIR) {
            bucket.push(row);
          } else {
            const j = Math.floor(Math.random() * seen);
            if (j < RESERVOIR) bucket[j] = row;
          }
        }
        return true; // read the whole slice; it is already bounded by SLICE_BYTES
      });

      let added = 0;
      for (const theme of ALL_THEMES) {
        const room = Math.min(PER_THEME_BATCH, PER_THEME_CAP - counts[theme]);
        if (room <= 0) continue;
        for (const row of shuffle(candidates[theme]).slice(0, room)) {
          if (pool[row.id]) continue;
          const puzzle = toPuzzle(row);
          if (!puzzle) continue;
          pool[puzzle.id] = puzzle;
          added += 1;
          for (const t of puzzle.themes) if (t in counts) counts[t] += 1;
        }
      }

      this.savePool(pool);
      if (added > 0) this.store.set('lastImport', Date.now());
      return this.status();
    } catch (err) {
      this.lastError = (err as Error).message;
      return this.status();
    } finally {
      this.importing = false;
    }
  }
}
