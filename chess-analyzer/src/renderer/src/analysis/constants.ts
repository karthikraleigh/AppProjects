import type { MoveGrade } from '@shared/types';

/**
 * Grading thresholds, expressed as win-probability lost by the mover (0..1).
 * Centralised so they can be tuned in one place.
 *
 * These do not reproduce chess.com's proprietary labels exactly; they are a
 * documented heuristic over real engine output.
 */
export const WP_LOSS = {
  excellent: 0.02,
  good: 0.05,
  inaccuracy: 0.1,
  mistake: 0.2,
  // anything above `mistake` is a blunder
} as const;

/**
 * A move is "Great" (the only move) when every alternative is at least this
 * much worse in win probability.
 */
export const GREAT_GAP = 0.15;

/** Minimum material given up (centipawns) for a move to be considered a sacrifice. */
export const SACRIFICE_CP = 200;

/** A brilliant sacrifice must keep the position at least this good for the mover (cp). */
export const BRILLIANT_MIN_CP = -50;

/** A brilliant move may lose at most this much win probability. */
export const BRILLIANT_MAX_WP_LOSS = 0.02;

/** During review, positions whose shallow eval swings more than this get a deep re-check. */
export const DEEP_RECHECK_WP = 0.04;

export const GRADE_META: Record<MoveGrade, { label: string; color: string; symbol: string }> = {
  brilliant: { label: 'Brilliant', color: '#26c2a3', symbol: '!!' },
  great: { label: 'Great', color: '#5b8bb0', symbol: '!' },
  best: { label: 'Best', color: '#95bb4a', symbol: '★' },
  excellent: { label: 'Excellent', color: '#96bc4b', symbol: '' },
  good: { label: 'Good', color: '#96af8b', symbol: '' },
  book: { label: 'Book', color: '#a88865', symbol: '📖' },
  inaccuracy: { label: 'Inaccuracy', color: '#f7c631', symbol: '?!' },
  mistake: { label: 'Mistake', color: '#ffa459', symbol: '?' },
  miss: { label: 'Miss', color: '#ff7769', symbol: '×' },
  blunder: { label: 'Blunder', color: '#fa412d', symbol: '??' },
};

/** Piece values in centipawns, for sacrifice detection. */
export const PIECE_CP: Record<string, number> = { p: 100, n: 300, b: 320, r: 500, q: 900, k: 0 };
