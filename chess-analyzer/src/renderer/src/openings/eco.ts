import { Chess } from 'chess.js';
import aTsv from './data/a.tsv?raw';
import bTsv from './data/b.tsv?raw';
import cTsv from './data/c.tsv?raw';
import dTsv from './data/d.tsv?raw';
import eTsv from './data/e.tsv?raw';

export interface Opening {
  eco: string;
  name: string;
  /** Moves of the main line, SAN. */
  moves: string[];
}

/**
 * Position key: the first four FEN fields (piece placement, side, castling,
 * en passant). Halfmove/fullmove counters are dropped so transpositions match.
 */
export function epd(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

let index: Map<string, Opening> | null = null;
/**
 * How many named ECO lines pass through each position. Used as a popularity
 * proxy to rank book continuations -- without it, moves come back in chess.js
 * move-generation order and 1...e5 ranks below 1...Nh6.
 */
let passCount: Map<string, number> = new Map();
/**
 * Positions that lie on a named trap line, with how many plies remain until the
 * trap springs. The dataset contains 14 such lines (Noah's Ark, Lasker,
 * Mortimer, Tarrasch, ...).
 */
let trapIndex: Map<string, TrapWarning[]> = new Map();

export interface TrapWarning {
  name: string;
  eco: string;
  /** Half-moves from this position to the end of the trap line. */
  pliesAway: number;
}

/** How close to a trap's final position we start warning. */
const TRAP_HORIZON = 4;

/**
 * Build the EPD -> opening index by replaying all 3,790 ECO lines.
 *
 * Costs a few hundred ms once. Done lazily so it never blocks first paint.
 */
export function getOpeningIndex(): Map<string, Opening> {
  if (index) return index;

  const map = new Map<string, Opening>();
  const counts = new Map<string, number>();
  const traps = new Map<string, TrapWarning[]>();

  for (const tsv of [aTsv, bTsv, cTsv, dTsv, eTsv]) {
    const lines = tsv.split('\n');
    // Row 0 is the header: eco \t name \t pgn
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i];
      if (!row.trim()) continue;
      const [eco, name, pgn] = row.split('\t');
      if (!eco || !name || !pgn) continue;

      const game = new Chess();
      try {
        game.loadPgn(pgn);
      } catch {
        continue; // skip malformed row rather than fail the whole index
      }
      const moves = game.history();

      // Count every position this line passes through, and mark the tail of
      // any named trap line so we can warn before it springs.
      const isTrap = name.includes('Trap');
      const walk = new Chess();
      moves.forEach((san, ply) => {
        walk.move(san);
        const k = epd(walk.fen());
        counts.set(k, (counts.get(k) ?? 0) + 1);

        if (isTrap) {
          const pliesAway = moves.length - (ply + 1);
          // Every trap line starts at the opening position; warning there would
          // be noise. Only the last few plies are actually "walking into it".
          if (pliesAway <= TRAP_HORIZON) {
            const list = traps.get(k) ?? [];
            if (!list.some((t) => t.name === name)) list.push({ name, eco, pliesAway });
            traps.set(k, list);
          }
        }
      });

      // Later files can restate a position; the first (lowest ECO) wins.
      const key = epd(game.fen());
      if (!map.has(key)) map.set(key, { eco, name, moves });
    }
  }

  index = map;
  passCount = counts;
  trapIndex = traps;
  return index;
}

/**
 * Named traps this position is walking into, nearest first.
 * Empty for the vast majority of positions.
 */
export function trapsNear(fen: string): TrapWarning[] {
  getOpeningIndex(); // ensure built
  const hits = trapIndex.get(epd(fen)) ?? [];
  return [...hits].sort((a, b) => a.pliesAway - b.pliesAway);
}

/** The opening whose line ends exactly at this position, if any. */
export function lookupOpening(fen: string): Opening | undefined {
  return getOpeningIndex().get(epd(fen));
}

/**
 * Is this position still theory?
 *
 * Tests the set of positions *traversed* by any named line, not just the
 * positions where a line happens to end. Using the terminal set here would call
 * 4.Ba4 in the Ruy Lopez "out of book", because no ECO row stops there.
 */
export function isBookPosition(fen: string): boolean {
  getOpeningIndex(); // ensure built
  return passCount.has(epd(fen));
}

/**
 * Walk a game's positions and attach the most specific opening seen so far.
 * Returns the opening and the ply at which the game left book (-1 if never).
 */
export function classifyGame(fensAfterEachMove: string[]): {
  opening?: Opening;
  leftBookAtPly: number;
} {
  const idx = getOpeningIndex();
  let opening: Opening | undefined;
  let leftBookAtPly = -1;

  for (let ply = 0; ply < fensAfterEachMove.length; ply++) {
    const key = epd(fensAfterEachMove[ply]);

    // The most specific *named* line seen so far, carried forward: many book
    // positions sit mid-line and have no name of their own.
    const named = idx.get(key);
    if (named) opening = named;

    // Theory ends at the first position no named line passes through, and
    // never resumes for this game.
    if (leftBookAtPly === -1 && !passCount.has(key)) leftBookAtPly = ply;
  }
  return { opening, leftBookAtPly };
}

/** Total number of indexed openings. */
export function openingCount(): number {
  return getOpeningIndex().size;
}

/** Substring search over opening names, for the explorer UI. */
export function searchOpenings(query: string, limit = 50): Opening[] {
  const q = query.trim().toLowerCase();
  const all = [...getOpeningIndex().values()];
  if (!q) return all.slice(0, limit);
  return all.filter((o) => o.name.toLowerCase().includes(q) || o.eco.toLowerCase() === q).slice(0, limit);
}

export interface Continuation {
  san: string;
  /** Set only when a named line ends exactly at the resulting position. */
  opening: Opening | null;
  /** Named ECO lines passing through the resulting position. */
  weight: number;
}

/**
 * Book moves from this position, most-travelled first.
 *
 * Includes any move that stays on a named line -- not only moves landing on a
 * line's final position, or mainline continuations like 6...Nxd4 (which no ECO
 * row terminates at) would silently vanish from the explorer.
 *
 * Ranked by how many named lines pass through the result, so the mainlines
 * (1...e5, 1...c5) surface above curiosities (1...Nh6).
 */
export function continuations(fen: string): Continuation[] {
  const idx = getOpeningIndex();
  let game: Chess;
  try {
    game = new Chess(fen);
  } catch {
    return [];
  }

  const out: Continuation[] = [];
  for (const move of game.moves()) {
    const probe = new Chess(fen);
    probe.move(move);
    const key = epd(probe.fen());
    const weight = passCount.get(key);
    if (weight === undefined) continue; // leaves theory entirely
    out.push({ san: move, opening: idx.get(key) ?? null, weight });
  }

  return out.sort((a, b) => b.weight - a.weight || a.san.localeCompare(b.san));
}
