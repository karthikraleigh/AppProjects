import type { Puzzle, PuzzleDifficulty, PuzzleProgress, ThemeProgress } from '@shared/types';
import { DIFFICULTY_BANDS } from '@shared/types';

const K = 24;
const MIN_RATING = 400;
const MAX_RATING = 3000;

/** Standard Elo expectation. */
export function expectedScore(playerRating: number, puzzleRating: number): number {
  return 1 / (1 + 10 ** ((puzzleRating - playerRating) / 400));
}

/**
 * Update the player's rating against a puzzle's own rating.
 * A puzzle solved with a hint or after a wrong move scores 0 — the point of the
 * rating is to track what you can find unaided.
 */
export function updateRating(playerRating: number, puzzleRating: number, clean: boolean): number {
  const expected = expectedScore(playerRating, puzzleRating);
  const next = playerRating + K * ((clean ? 1 : 0) - expected);
  return Math.round(Math.max(MIN_RATING, Math.min(MAX_RATING, next)));
}

export function emptyTheme(): ThemeProgress {
  return { solved: 0, attempted: 0, seen: [] };
}

export function themeStats(progress: PuzzleProgress, theme: string): ThemeProgress {
  return progress.themes[theme] ?? emptyTheme();
}

/** Record the outcome of one puzzle. Returns a new progress object. */
export function recordResult(
  progress: PuzzleProgress,
  puzzle: Puzzle,
  theme: string,
  clean: boolean,
): PuzzleProgress {
  const stats = themeStats(progress, theme);
  const seen = stats.seen.includes(puzzle.id) ? stats.seen : [...stats.seen, puzzle.id];

  return {
    rating: updateRating(progress.rating, puzzle.rating, clean),
    streak: clean ? progress.streak + 1 : 0,
    bestStreak: Math.max(progress.bestStreak, clean ? progress.streak + 1 : progress.streak),
    themes: {
      ...progress.themes,
      [theme]: {
        solved: stats.solved + (clean ? 1 : 0),
        attempted: stats.attempted + 1,
        // Cap the seen list; it only exists to avoid immediate repeats.
        seen: seen.slice(-500),
      },
    },
  };
}

/**
 * Choose the next puzzle: right difficulty band, not seen before, random.
 * Falls back to seen puzzles once a band is exhausted rather than showing none.
 */
export function pickPuzzle(
  puzzles: Puzzle[],
  difficulty: PuzzleDifficulty,
  seen: string[],
): Puzzle | null {
  const [lo, hi] = DIFFICULTY_BANDS[difficulty];
  const inBand = puzzles.filter((p) => p.rating >= lo && p.rating < hi);
  const pool = inBand.length ? inBand : puzzles;
  if (!pool.length) return null;

  const seenSet = new Set(seen);
  const unseen = pool.filter((p) => !seenSet.has(p.id));
  const from = unseen.length ? unseen : pool;
  return from[Math.floor(Math.random() * from.length)];
}
