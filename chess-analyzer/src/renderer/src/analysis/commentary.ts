import { Chess, type Square } from 'chess.js';
import type { GradedMove } from '@shared/types';
import { PIECE_CP } from './constants';
import { formatEval } from './winprob';

const PIECE_NAME: Record<string, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

/**
 * Pieces of `color` that the opponent attacks and nobody defends.
 * A cheap approximation of "hanging" -- not a full static exchange evaluation.
 */
export function hangingPieces(fen: string, color: 'w' | 'b'): Array<{ square: Square; type: string }> {
  let game: Chess;
  try {
    game = new Chess(fen);
  } catch {
    return [];
  }
  const enemy = color === 'w' ? 'b' : 'w';
  const out: Array<{ square: Square; type: string }> = [];

  for (const row of game.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== color || sq.type === 'k') continue;
      if (!game.isAttacked(sq.square, enemy)) continue;
      if (!game.isAttacked(sq.square, color)) out.push({ square: sq.square, type: sq.type });
    }
  }
  return out;
}

/**
 * After `san` is played in `fen`, does the moved piece attack two or more
 * enemy pieces worth a knight or more? Names the fork motif.
 *
 * Uses `attackers()` so no side-to-move flipping is needed.
 */
export function detectsFork(fen: string, san: string): boolean {
  let game: Chess;
  let moved;
  try {
    game = new Chess(fen);
    moved = game.move(san);
  } catch {
    return false;
  }

  const mover = moved.color;
  const enemy = mover === 'w' ? 'b' : 'w';
  const landed = moved.to as Square;

  let valuable = 0;
  for (const row of game.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== enemy) continue;
      if ((PIECE_CP[sq.type] ?? 0) < 300) continue;
      if (game.attackers(sq.square, mover).includes(landed)) valuable++;
    }
  }
  return valuable >= 2;
}

/** Render a SAN sequence with move numbers, starting from `startFen`. */
function joinSan(sans: string[], startFen: string): string {
  let game: Chess;
  try {
    game = new Chess(startFen);
  } catch {
    return sans.join(' ');
  }

  const parts: string[] = [];
  for (const san of sans) {
    const isWhite = game.turn() === 'w';
    const moveNo = Number(game.fen().split(' ')[5] ?? 1);
    let moved;
    try {
      moved = game.move(san);
    } catch {
      break;
    }
    if (isWhite) parts.push(`${moveNo}. ${moved.san}`);
    else parts.push(parts.length === 0 ? `${moveNo}...${moved.san}` : moved.san);
  }
  return parts.join(' ');
}

/**
 * Explain a move in a sentence or two, entirely from engine output plus board
 * facts. Deterministic and offline -- no model in the loop.
 */
export function explainMove(move: GradedMove): string {
  const { grade, san, bestSan, refutation, fenBefore, fenAfter, evalAfterCp } = move;
  const mover = move.color;
  const evalStr = formatEval(evalAfterCp);

  if (grade === 'book') {
    return move.opening
      ? `Book move. This is the ${move.opening.name} (${move.opening.eco}).`
      : 'Book move — still following known opening theory.';
  }

  const sentences: string[] = [];

  switch (grade) {
    case 'brilliant':
      sentences.push(`Brilliant. ${san} gives up material, yet the position holds at ${evalStr}.`);
      break;
    case 'great':
      sentences.push(`Great move. ${san} was the only move holding the evaluation at ${evalStr}.`);
      break;
    case 'best':
      sentences.push(`Best. ${san} is the engine's top choice (${evalStr}).`);
      break;
    case 'excellent':
      sentences.push(`Excellent. ${san} keeps the evaluation at ${evalStr}.`);
      break;
    case 'good':
      sentences.push(`Good. ${san} is solid (${evalStr}).`);
      break;
    case 'inaccuracy':
      sentences.push(`Inaccuracy. ${san} lets the evaluation slip to ${evalStr}.`);
      break;
    case 'mistake':
      sentences.push(`Mistake. ${san} concedes real ground — the evaluation is now ${evalStr}.`);
      break;
    case 'miss':
      sentences.push(`Missed win. ${san} throws away a forced mate.`);
      break;
    case 'blunder':
      sentences.push(`Blunder. ${san} loses decisive material or position (${evalStr}).`);
      break;
  }

  const isGoodGrade = grade === 'best' || grade === 'great' || grade === 'brilliant';

  // Call out a piece that became undefended as a result of this move.
  if (!isGoodGrade) {
    const before = hangingPieces(fenBefore, mover).length;
    const after = hangingPieces(fenAfter, mover);
    if (after.length > before) {
      const worst = after.reduce((a, b) => ((PIECE_CP[b.type] ?? 0) > (PIECE_CP[a.type] ?? 0) ? b : a));
      sentences.push(`It leaves the ${PIECE_NAME[worst.type]} on ${worst.square} undefended.`);
    }
  }

  if (refutation?.length && !isGoodGrade) {
    const line = joinSan(refutation.slice(0, 4), fenAfter);
    if (line) {
      const fork = detectsFork(fenAfter, refutation[0]);
      sentences.push(`The engine continues ${line}.${fork ? ' Note the fork.' : ''}`);
    }
  }

  if (bestSan && bestSan !== san && !isGoodGrade) {
    sentences.push(`${bestSan} was stronger.`);
  }

  return sentences.join(' ');
}
