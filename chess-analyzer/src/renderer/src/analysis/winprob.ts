import type { InfoLine } from '@shared/types';

/** Centipawn value a forced mate is clamped to, so arithmetic stays finite. */
export const MATE_CP = 10_000;

/**
 * Convert an engine score to centipawns from White's point of view.
 * Engine scores are always relative to the side to move.
 */
export function toWhiteCp(line: Pick<InfoLine, 'cp' | 'mate'>, sideToMove: 'w' | 'b'): number {
  let cp: number;
  if (line.mate !== undefined) {
    cp = line.mate > 0 ? MATE_CP - line.mate * 10 : -MATE_CP - line.mate * 10;
  } else {
    cp = line.cp ?? 0;
  }
  return sideToMove === 'w' ? cp : -cp;
}

/**
 * Win probability for White, 0..1.
 *
 * Lichess's logistic fit. Using this instead of raw centipawns is what makes
 * grading sane: 100cp swung at +0.2 is decisive, the same 100cp at +9.0 is noise.
 */
export function winProb(cpWhite: number): number {
  return 1 / (1 + Math.exp(-0.00368208 * cpWhite));
}

/**
 * Win probability lost by the player who moved, 0..1.
 *
 * `cpBefore` is the eval of the position before the move assuming the mover
 * plays the engine's best move; `cpAfter` is the eval after the move actually
 * played. Both White-POV.
 */
export function wpLossForMover(cpBefore: number, cpAfter: number, mover: 'w' | 'b'): number {
  const before = winProb(cpBefore);
  const after = winProb(cpAfter);
  const loss = mover === 'w' ? before - after : after - before;
  return Math.max(0, loss);
}

/** Human-readable eval, White-POV: "+1.24", "-0.30", "M4", "-M2". */
export function formatEval(cpWhite: number): string {
  if (Math.abs(cpWhite) >= MATE_CP - 1000) {
    const movesToMate = Math.round((MATE_CP - Math.abs(cpWhite)) / 10);
    const sign = cpWhite > 0 ? '' : '-';
    return `${sign}M${Math.max(1, movesToMate)}`;
  }
  const pawns = cpWhite / 100;
  return (pawns >= 0 ? '+' : '') + pawns.toFixed(2);
}

export function isMateScore(cpWhite: number): boolean {
  return Math.abs(cpWhite) >= MATE_CP - 1000;
}
