/** Shared between main, preload and renderer. Keep dependency-free. */

export type EngineBuild = 'lite-single' | 'single';

export const ENGINE_BUILD_FILES: Record<EngineBuild, string> = {
  'lite-single': 'stockfish-18-lite-single',
  single: 'stockfish-18-single',
};

/** A single `info ...` line from the engine, parsed. Scores are side-to-move POV. */
export interface InfoLine {
  depth: number;
  seldepth?: number;
  multipv: number;
  /** Centipawns, side-to-move POV. Mutually exclusive with `mate`. */
  cp?: number;
  /** Moves to mate, side-to-move POV. Negative = being mated. */
  mate?: number;
  nodes?: number;
  nps?: number;
  timeMs?: number;
  /** Principal variation, UCI move strings. */
  pv: string[];
}

/** Result of analysing one position: the top-N lines, best first. */
export interface PositionEval {
  fen: string;
  depth: number;
  lines: InfoLine[];
  bestMove?: string;
}

export interface EngineOptions {
  build: EngineBuild;
  /** Transposition table size, MB. */
  hashMb: number;
  multipv: number;
  /** Depth for live/interactive analysis. */
  liveDepth: number;
  /** Depth for the deep pass of a full-game review. */
  reviewDepth: number;
  /** Depth for the fast first pass of a full-game review. */
  reviewShallowDepth: number;
}

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  build: 'lite-single',
  hashMb: 128,
  multipv: 3,
  liveDepth: 18,
  reviewDepth: 18,
  reviewShallowDepth: 12,
};

export type MoveGrade =
  | 'book'
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'miss';

export interface GradedMove {
  ply: number;
  san: string;
  uci: string;
  /** Colour that played this move. */
  color: 'w' | 'b';
  fenBefore: string;
  fenAfter: string;
  grade: MoveGrade;
  /** Win-probability lost by the mover, 0..1. */
  wpLoss: number;
  /** White-POV evaluation after the move, in centipawns (mate clamped). */
  evalAfterCp: number;
  /** Engine's preferred move in the position before, SAN. */
  bestSan?: string;
  bestUci?: string;
  /** Refutation / continuation line after the played move, SAN. */
  refutation?: string[];
  opening?: { eco: string; name: string };
  commentary?: string;
}

export interface GameMeta {
  id: string;
  white: string;
  black: string;
  result: string;
  date?: string;
  event?: string;
  site?: string;
  whiteElo?: string;
  blackElo?: string;
  source: 'chess.com' | 'lichess' | 'pgn';
}

export interface StoredGame {
  meta: GameMeta;
  pgn: string;
}

export interface ReviewProgress {
  done: number;
  total: number;
  phase: 'shallow' | 'deep';
}

// ---------------------------------------------------------------- puzzles ---

export interface Puzzle {
  id: string;
  /** Position the solver is presented with. */
  fen: string;
  /** UCI moves. Index 0 is the solver's first move; opponent replies interleave. */
  solution: string[];
  rating: number;
  themes: string[];
  /** Lichess game this came from, if known. */
  gameUrl?: string;
  /** Set for the official Lichess Puzzle of the Day. */
  daily?: boolean;
}

export interface ThemeProgress {
  solved: number;
  attempted: number;
  /** Puzzle ids already served, so they don't repeat. */
  seen: string[];
}

export interface PuzzleProgress {
  /** Elo-style rating, updated against each puzzle's own rating. */
  rating: number;
  streak: number;
  bestStreak: number;
  themes: Record<string, ThemeProgress>;
}

export const DEFAULT_PROGRESS: PuzzleProgress = {
  rating: 1200,
  streak: 0,
  bestStreak: 0,
  themes: {},
};

export interface PuzzlePoolStatus {
  total: number;
  /** Puzzles held per theme. */
  byTheme: Record<string, number>;
  /** Epoch ms of the last successful import, or 0. */
  lastImport: number;
  importing: boolean;
  lastError?: string;
}

export type PuzzleDifficulty = 'easy' | 'medium' | 'hard';

/** Rating bands, from the dump's distribution (p10≈805, p50≈1410, p90≈2242). */
export const DIFFICULTY_BANDS: Record<PuzzleDifficulty, [number, number]> = {
  easy: [0, 1200],
  medium: [1200, 1700],
  hard: [1700, 4000],
};
