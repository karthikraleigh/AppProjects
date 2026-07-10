import { Chess } from 'chess.js';
import type { EngineOptions, GradedMove, PositionEval, ReviewProgress } from '@shared/types';
import type { EngineClient } from '@/engine/client';
import { isBookPosition, lookupOpening } from '@/openings/eco';
import { DEEP_RECHECK_WP } from './constants';
import { explainMove } from './commentary';
import { gradeMove, pvToSan, uciToSan } from './grade';
import { toWhiteCp, wpLossForMover } from './winprob';

export interface ReviewedGame {
  moves: GradedMove[];
  /** White-POV eval after each ply, centipawns. Index 0 = after ply 1. */
  evals: number[];
  accuracy: { white: number; black: number };
  cacheKey: string;
}

export interface ReviewRequest {
  pgn: string;
  engine: EngineClient;
  options: EngineOptions;
  onProgress?: (p: ReviewProgress) => void;
  signal?: { cancelled: boolean };
}

interface Ply {
  san: string;
  uci: string;
  color: 'w' | 'b';
  fenBefore: string;
  fenAfter: string;
}

function toUci(move: { from: string; to: string; promotion?: string }): string {
  return move.from + move.to + (move.promotion ?? '');
}

/** Expand a PGN into per-ply positions. */
export function splitPlies(pgn: string): Ply[] {
  const game = new Chess();
  game.loadPgn(pgn);
  const history = game.history({ verbose: true });

  const replay = new Chess();
  const plies: Ply[] = [];
  for (const mv of history) {
    const fenBefore = replay.fen();
    replay.move(mv.san);
    plies.push({
      san: mv.san,
      uci: toUci(mv),
      color: mv.color,
      fenBefore,
      fenAfter: replay.fen(),
    });
  }
  return plies;
}

/**
 * Chess.com-style accuracy from average win-probability loss.
 * A presentational summary, not a claim of parity with their formula.
 */
function accuracyFromLosses(losses: number[]): number {
  if (!losses.length) return 100;
  const avg = losses.reduce((a, b) => a + b, 0) / losses.length;
  const raw = 103.1668 * Math.exp(-4.354 * avg) - 3.1669;
  return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
}

export function reviewCacheKey(pgn: string, options: EngineOptions): string {
  // Cheap stable hash; collisions here only cost a recompute.
  let h = 2166136261;
  // Every input that changes the output must be in the key, or a settings
  // change silently serves a stale review.
  const material = [
    pgn,
    options.build,
    options.reviewDepth,
    options.reviewShallowDepth,
    options.multipv,
  ].join('|');
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 'review:' + (h >>> 0).toString(36);
}

/**
 * Review a full game.
 *
 * Two passes, because a deep pass over every ply is ~2 minutes:
 *   1. shallow pass over every position
 *   2. deep re-analysis only where the shallow eval swung, or the grade is
 *      near a threshold
 * Book positions are skipped entirely -- they're graded from the ECO index.
 */
export async function reviewGame(req: ReviewRequest): Promise<ReviewedGame> {
  const { pgn, engine, options, onProgress, signal } = req;
  const plies = splitPlies(pgn);

  // We need the eval of every position: the one before each ply, plus the final.
  const fens = [plies[0]?.fenBefore ?? new Chess().fen(), ...plies.map((p) => p.fenAfter)];
  const bookFlags = fens.map((f) => isBookPosition(f));

  const evalsByFen = new Map<string, PositionEval>();

  const analyzeAt = async (fen: string, depth: number): Promise<PositionEval> => {
    const existing = evalsByFen.get(fen);
    if (existing && existing.depth >= depth) return existing;

    const res = await engine.analyze(fen, { depth, multipv: options.multipv });
    // A superseded search resolves for a different position; don't trust it.
    if (res.fen !== fen) return existing ?? res;
    evalsByFen.set(fen, res);
    return res;
  };

  // ---- Pass 1: shallow, over the positions grading actually needs --------
  //
  // Grading ply i compares the eval BEFORE it against the eval AFTER it, so
  // both endpoints of every non-book ply are required. Filtering out all book
  // positions would drop the position before the first out-of-book move -- and
  // that move would then be graded against a phantom 0.00.
  //
  // Positions repeat (repetitions, transpositions), so dedupe: the engine's
  // answer depends only on the FEN.
  const shallowTargets: string[] = [];
  const seen = new Set<string>();
  plies.forEach((ply, i) => {
    if (bookFlags[i + 1]) return; // book move: graded from the ECO index, not the engine
    for (const f of [ply.fenBefore, ply.fenAfter]) {
      if (!seen.has(f)) {
        seen.add(f);
        shallowTargets.push(f);
      }
    }
  });

  let done = 0;
  for (const fen of shallowTargets) {
    if (signal?.cancelled) throw new Error('cancelled');
    await analyzeAt(fen, options.reviewShallowDepth);
    done++;
    onProgress?.({ done, total: shallowTargets.length, phase: 'shallow' });
  }

  // ---- Identify candidates for a deep look ------------------------------
  const candidates = new Set<string>();
  for (const ply of plies) {
    const before = evalsByFen.get(ply.fenBefore);
    const after = evalsByFen.get(ply.fenAfter);
    if (!before || !after || !before.lines[0] || !after.lines[0]) continue;

    const cpBefore = toWhiteCp(before.lines[0], ply.color);
    const cpAfter = toWhiteCp(after.lines[0], ply.color === 'w' ? 'b' : 'w');
    const loss = wpLossForMover(cpBefore, cpAfter, ply.color);
    if (loss >= DEEP_RECHECK_WP) {
      candidates.add(ply.fenBefore);
      candidates.add(ply.fenAfter);
    }
  }

  // ---- Pass 2: deep, candidates only ------------------------------------
  let deepDone = 0;
  for (const fen of candidates) {
    if (signal?.cancelled) throw new Error('cancelled');
    await analyzeAt(fen, options.reviewDepth);
    deepDone++;
    onProgress?.({ done: deepDone, total: candidates.size, phase: 'deep' });
  }

  // ---- Grade ------------------------------------------------------------
  const moves: GradedMove[] = [];
  const evals: number[] = [];
  const lossesW: number[] = [];
  const lossesB: number[] = [];

  plies.forEach((ply, i) => {
    const before = evalsByFen.get(ply.fenBefore);
    const after = evalsByFen.get(ply.fenAfter);
    const bookMove = bookFlags[i + 1];

    // Book positions were never sent to the engine; synthesise a neutral eval.
    const beforeEval: PositionEval = before ?? { fen: ply.fenBefore, depth: 0, lines: [] };
    const afterEval: PositionEval = after ?? { fen: ply.fenAfter, depth: 0, lines: [] };

    const g = gradeMove({
      before: beforeEval,
      after: afterEval,
      fenBefore: ply.fenBefore,
      fenAfter: ply.fenAfter,
      playedUci: ply.uci,
      mover: ply.color,
      isBook: bookMove,
    });

    const bestUci = g.bestUci;
    const graded: GradedMove = {
      ply: i + 1,
      san: ply.san,
      uci: ply.uci,
      color: ply.color,
      fenBefore: ply.fenBefore,
      fenAfter: ply.fenAfter,
      grade: g.grade,
      wpLoss: g.wpLoss,
      evalAfterCp: g.cpAfter,
      bestUci,
      bestSan: bestUci ? uciToSan(ply.fenBefore, bestUci) ?? undefined : undefined,
      refutation: afterEval.lines[0]?.pv ? pvToSan(ply.fenAfter, afterEval.lines[0].pv, 4) : undefined,
      opening: lookupOpening(ply.fenAfter),
    };
    graded.commentary = explainMove(graded);

    moves.push(graded);
    evals.push(g.cpAfter);
    if (!bookMove) (ply.color === 'w' ? lossesW : lossesB).push(g.wpLoss);
  });

  return {
    moves,
    evals,
    accuracy: { white: accuracyFromLosses(lossesW), black: accuracyFromLosses(lossesB) },
    cacheKey: reviewCacheKey(pgn, options),
  };
}
