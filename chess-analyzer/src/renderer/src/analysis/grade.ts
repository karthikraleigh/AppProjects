import { Chess } from 'chess.js';
import type { MoveGrade, PositionEval } from '@shared/types';
import {
  BRILLIANT_MAX_WP_LOSS,
  BRILLIANT_MIN_CP,
  GREAT_GAP,
  PIECE_CP,
  SACRIFICE_CP,
  WP_LOSS,
} from './constants';
import { isMateScore, toWhiteCp, winProb, wpLossForMover } from './winprob';

/** Material balance from White's POV, in centipawns. */
export function materialCp(fen: string): number {
  const board = new Chess(fen).board();
  let total = 0;
  for (const row of board) {
    for (const sq of row) {
      if (!sq) continue;
      const v = PIECE_CP[sq.type] ?? 0;
      total += sq.color === 'w' ? v : -v;
    }
  }
  return total;
}

/**
 * Did the mover give up material that the opponent can simply take?
 *
 * Compares material before the move with material after the opponent's best
 * reply. A real sacrifice loses material even when the opponent plays on.
 */
function isSacrifice(fenBefore: string, fenAfter: string, replyUci: string | undefined, mover: 'w' | 'b'): boolean {
  const before = materialCp(fenBefore);
  let after = materialCp(fenAfter);

  if (replyUci) {
    const board = new Chess(fenAfter);
    try {
      board.move({
        from: replyUci.slice(0, 2),
        to: replyUci.slice(2, 4),
        promotion: replyUci.slice(4, 5) || undefined,
      });
      after = materialCp(board.fen());
    } catch {
      // Illegal/unparseable reply: fall back to the immediate position.
    }
  }

  const deltaForMover = mover === 'w' ? after - before : before - after;
  return deltaForMover <= -SACRIFICE_CP;
}

export interface GradeInput {
  /** Analysis of the position BEFORE the move (multipv lines). */
  before: PositionEval;
  /** Analysis of the position AFTER the move. */
  after: PositionEval;
  fenBefore: string;
  fenAfter: string;
  /** The move actually played, UCI. */
  playedUci: string;
  mover: 'w' | 'b';
  isBook: boolean;
}

export interface GradeResult {
  grade: MoveGrade;
  wpLoss: number;
  cpBefore: number;
  cpAfter: number;
  bestUci?: string;
}

/**
 * Grade a single move.
 *
 * `cpBefore` is the eval assuming the mover plays the engine's best move.
 * `cpAfter` is the eval of the position actually reached. Both White-POV, so
 * the comparison direction depends on who moved.
 */
export function gradeMove(input: GradeInput): GradeResult {
  const { before, after, fenBefore, fenAfter, playedUci, mover, isBook } = input;

  const sideAfter: 'w' | 'b' = mover === 'w' ? 'b' : 'w';
  const bestLine = before.lines[0];
  const afterLine = after.lines[0];

  const cpBefore = bestLine ? toWhiteCp(bestLine, mover) : 0;
  const cpAfter = afterLine ? toWhiteCp(afterLine, sideAfter) : cpBefore;
  const wpLoss = wpLossForMover(cpBefore, cpAfter, mover);
  const bestUci = before.bestMove ?? bestLine?.pv[0];

  const base: Omit<GradeResult, 'grade'> = { wpLoss, cpBefore, cpAfter, bestUci };

  if (isBook) return { ...base, grade: 'book' };

  const playedBest = bestUci !== undefined && playedUci === bestUci;

  // Miss: a forced mate was available and the move threw it away.
  const hadMate = bestLine?.mate !== undefined && bestLine.mate > 0;
  const keptMate = afterLine?.mate !== undefined && afterLine.mate < 0; // mate against the new side to move
  if (hadMate && !keptMate && wpLoss > WP_LOSS.good) {
    return { ...base, grade: 'miss' };
  }

  // Brilliant: a sound sacrifice that keeps the position playable.
  const cpForMover = mover === 'w' ? cpAfter : -cpAfter;
  if (
    wpLoss <= BRILLIANT_MAX_WP_LOSS &&
    cpForMover >= BRILLIANT_MIN_CP &&
    !isMateScore(cpBefore) &&
    isSacrifice(fenBefore, fenAfter, afterLine?.pv[0], mover)
  ) {
    return { ...base, grade: 'brilliant' };
  }

  // Great: the played move is best and every alternative is clearly worse.
  if (playedBest && before.lines.length >= 2) {
    const bestWp = winProb(toWhiteCp(before.lines[0], mover));
    const secondWp = winProb(toWhiteCp(before.lines[1], mover));
    const gap = mover === 'w' ? bestWp - secondWp : secondWp - bestWp;
    if (gap >= GREAT_GAP) return { ...base, grade: 'great' };
  }

  if (playedBest) return { ...base, grade: 'best' };
  if (wpLoss <= WP_LOSS.excellent) return { ...base, grade: 'excellent' };
  if (wpLoss <= WP_LOSS.good) return { ...base, grade: 'good' };
  if (wpLoss <= WP_LOSS.inaccuracy) return { ...base, grade: 'inaccuracy' };
  if (wpLoss <= WP_LOSS.mistake) return { ...base, grade: 'mistake' };
  return { ...base, grade: 'blunder' };
}

/** Convert a UCI move to SAN in the given position. Returns null if illegal. */
export function uciToSan(fen: string, uci: string): string | null {
  const game = new Chess(fen);
  try {
    const move = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.slice(4, 5) || undefined,
    });
    return move.san;
  } catch {
    return null;
  }
}

/** Convert a UCI principal variation to SAN, stopping at the first illegal move. */
export function pvToSan(fen: string, pv: string[], limit = 6): string[] {
  const game = new Chess(fen);
  const out: string[] = [];
  for (const uci of pv.slice(0, limit)) {
    try {
      const move = game.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4, 5) || undefined,
      });
      out.push(move.san);
    } catch {
      break;
    }
  }
  return out;
}
