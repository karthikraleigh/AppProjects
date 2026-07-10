import { Chess } from 'chess.js';
import type { GradedMove, PositionEval } from '@shared/types';
import { isBookPosition, lookupOpening } from '@/openings/eco';
import { explainMove } from './commentary';
import { gradeMove, pvToSan, uciToSan } from './grade';

export interface PlyInfo {
  ply: number;
  san: string;
  uci: string;
  color: 'w' | 'b';
  fenBefore: string;
  fenAfter: string;
}

/**
 * Positions for every half-move, from a single replay of the game.
 *
 * Doing this once per history (rather than per ply, per engine update) keeps
 * live grading O(n) instead of O(n^2) -- the engine emits a deeper `info` line
 * many times per position, and each one used to trigger a full re-replay.
 */
export function buildPlyInfos(history: string[]): PlyInfo[] {
  const game = new Chess();
  const infos: PlyInfo[] = [];

  history.forEach((san, i) => {
    const fenBefore = game.fen();
    let moved;
    try {
      moved = game.move(san);
    } catch {
      return; // illegal SAN: stop contributing plies rather than throw
    }
    infos.push({
      ply: i + 1,
      san: moved.san,
      uci: moved.from + moved.to + (moved.promotion ?? ''),
      color: moved.color,
      fenBefore,
      fenAfter: game.fen(),
    });
  });

  return infos;
}

/**
 * Grade one ply from precomputed positions. Returns null until both the before-
 * and after-positions have been analysed, so a grade appears a beat after the
 * move rather than never.
 */
export function gradeFromInfo(info: PlyInfo, evals: Map<string, PositionEval>): GradedMove | null {
  const before = evals.get(info.fenBefore);
  const after = evals.get(info.fenAfter);
  if (!before?.lines.length || !after?.lines.length) return null;

  const result = gradeMove({
    before,
    after,
    fenBefore: info.fenBefore,
    fenAfter: info.fenAfter,
    playedUci: info.uci,
    mover: info.color,
    isBook: isBookPosition(info.fenAfter),
  });

  const graded: GradedMove = {
    ply: info.ply,
    san: info.san,
    uci: info.uci,
    color: info.color,
    fenBefore: info.fenBefore,
    fenAfter: info.fenAfter,
    grade: result.grade,
    wpLoss: result.wpLoss,
    evalAfterCp: result.cpAfter,
    bestUci: result.bestUci,
    bestSan: result.bestUci ? uciToSan(info.fenBefore, result.bestUci) ?? undefined : undefined,
    refutation: after.lines[0]?.pv ? pvToSan(info.fenAfter, after.lines[0].pv, 4) : undefined,
    opening: lookupOpening(info.fenAfter),
  };
  graded.commentary = explainMove(graded);
  return graded;
}

/** A stand-in for plies we haven't been able to grade yet. */
export function placeholderMove(san: string, ply: number): GradedMove {
  return {
    ply,
    san,
    uci: '',
    color: ply % 2 === 1 ? 'w' : 'b',
    fenBefore: '',
    fenAfter: '',
    grade: 'good',
    wpLoss: 0,
    evalAfterCp: 0,
  };
}
