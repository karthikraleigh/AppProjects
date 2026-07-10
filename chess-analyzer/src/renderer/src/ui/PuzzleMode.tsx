import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Puzzle, PuzzleDifficulty, PuzzlePoolStatus, PuzzleProgress } from '@shared/types';
import { themeTitle } from '@shared/tactics';
import { pickPuzzle, recordResult, themeStats } from '@/puzzles/rating';
import { usePuzzle } from '@/puzzles/usePuzzle';
import { PlayableBoard } from '@/ui/PlayableBoard';

interface Props {
  theme: string;
  progress: PuzzleProgress;
  onProgress: (next: PuzzleProgress) => void;
  pool: PuzzlePoolStatus | null;
  onImport: () => void;
  onBack?: () => void;
}

const DIFFICULTIES: PuzzleDifficulty[] = ['easy', 'medium', 'hard'];

export function PuzzleMode({ theme, progress, onProgress, pool, onImport, onBack }: Props): React.JSX.Element {
  const [difficulty, setDifficulty] = useState<PuzzleDifficulty>('medium');
  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [scored, setScored] = useState(false);

  const stats = themeStats(progress, theme);

  useEffect(() => {
    let cancelled = false;
    setPuzzles(null);
    void window.api.puzzles.list(theme).then((list) => {
      if (!cancelled) setPuzzles(list);
    });
    return () => {
      cancelled = true;
    };
  }, [theme, pool?.total]);

  const next = useCallback(() => {
    if (!puzzles) return;
    setScored(false);
    setPuzzle(pickPuzzle(puzzles, difficulty, themeStats(progress, theme).seen));
    // `progress` intentionally read fresh each time so `seen` is current.
  }, [puzzles, difficulty, progress, theme]);

  // Load the first puzzle once the list arrives, and whenever difficulty changes.
  useEffect(() => {
    if (!puzzles) return;
    setScored(false);
    setPuzzle(pickPuzzle(puzzles, difficulty, themeStats(progress, theme).seen));
    // Deliberately not depending on `progress`: re-picking on every rating
    // change would swap the puzzle out from under the solver.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzles, difficulty, theme]);

  const p = usePuzzle(puzzle);

  // Verification harness only: the solution is needed to drive the board.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('testhook')) return;
    const w = window as unknown as { __puzzle?: unknown; __pickPuzzleById?: (id: string) => boolean };
    w.__puzzle = puzzle
      ? { id: puzzle.id, fen: puzzle.fen, solution: puzzle.solution, rating: puzzle.rating, status: p.status, index: p.index }
      : null;
    w.__pickPuzzleById = (id: string) => {
      const found = puzzles?.find((z) => z.id === id);
      if (!found) return false;
      setScored(false);
      setPuzzle(found);
      return true;
    };
  }, [puzzle, puzzles, p.status, p.index]);

  // Score exactly once, when the puzzle first completes.
  useEffect(() => {
    if (!puzzle || scored) return;
    if (p.status !== 'solved' && p.status !== 'revealed') return;
    setScored(true);
    onProgress(recordResult(progress, puzzle, theme, p.status === 'solved' && p.clean));
  }, [p.status, p.clean, puzzle, scored, progress, theme, onProgress]);

  // An inset outline, not a background: selecting the piece would paint over a
  // background and the hint would vanish exactly when it is being used.
  const highlights = useMemo(() => {
    if (!p.hintSquare) return undefined;
    return { [p.hintSquare]: { boxShadow: 'inset 0 0 0 4px rgba(90, 200, 140, 0.95)' } };
  }, [p.hintSquare]);

  const onMove = useCallback(
    (from: string, to: string, promotion: string) => p.tryMove(from, to, promotion),
    [p],
  );

  if (pool && pool.total === 0) {
    return (
      <div className="panel puzzle-panel">
        <div className="panel-head">
          <h3>Puzzles</h3>
        </div>
        <p className="muted small">
          No puzzles yet. Puzzles are imported from Lichess once a day and then work offline.
        </p>
        <button className="primary" onClick={onImport} disabled={pool.importing}>
          {pool.importing ? 'Importing…' : 'Import puzzles now'}
        </button>
        {pool.lastError && <p className="error small">{pool.lastError}</p>}
      </div>
    );
  }

  const total = puzzles?.length ?? 0;
  const solverToMove = p.solverColor === 'w' ? 'White' : 'Black';

  return (
    <div className="puzzle-mode">
      <div className="board-column">
        <div className="board-wrap">
          <div className="board">
            <PlayableBoard
              fen={p.fen}
              onMove={onMove}
              orientation={p.solverColor === 'w' ? 'white' : 'black'}
              highlights={highlights}
              interactive={p.status === 'solving' || p.status === 'wrong'}
            />
          </div>
        </div>

        <div className="controls">
          <button onClick={p.hint} disabled={p.status === 'solved' || p.status === 'revealed'}>
            Hint
          </button>
          <button onClick={p.reveal} disabled={p.status === 'solved' || p.status === 'revealed'}>
            Solution
          </button>
          <button onClick={p.reset} disabled={p.status === 'solving' && p.index === 0}>
            Retry
          </button>
          <button className="primary" onClick={next} disabled={!puzzles}>
            Next puzzle
          </button>
        </div>
      </div>

      <div className="side-column">
        <div className="panel">
          <div className="panel-head">
            <h3>{themeTitle(theme)}</h3>
            {onBack && (
              <button className="ghost small" onClick={onBack}>
                back
              </button>
            )}
          </div>

          {!puzzle ? (
            <p className="muted small">{puzzles ? 'No puzzles for this theme yet.' : 'Loading…'}</p>
          ) : (
            <>
              <div className={`puzzle-status ${p.status}`}>
                {p.status === 'solving' && (
                  <>
                    <b>{solverToMove} to play.</b> Find the best move.
                  </>
                )}
                {p.status === 'wrong' && (
                  <>
                    <b>Not that one.</b> {p.lastWrong} doesn’t work — try again.
                  </>
                )}
                {p.status === 'solved' && (
                  <>
                    <b>Solved{p.clean ? '' : ' (with help)'}.</b> {p.clean ? 'Clean.' : ''}
                  </>
                )}
                {p.status === 'revealed' && <b>Solution shown.</b>}
              </div>

              <div className="puzzle-meta muted small">
                Rating {puzzle.rating} · move {Math.floor(p.index / 2) + 1} of{' '}
                {Math.ceil(puzzle.solution.length / 2)}
                {puzzle.daily && <span className="daily-badge">Puzzle of the Day</span>}
              </div>

              <div className="puzzle-themes">
                {puzzle.themes.slice(0, 6).map((t) => (
                  <span key={t} className="theme-chip">
                    {themeTitle(t)}
                  </span>
                ))}
              </div>

              {puzzle.gameUrl && (
                <a className="muted small" href={puzzle.gameUrl} target="_blank" rel="noreferrer">
                  View on Lichess ↗
                </a>
              )}
            </>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Difficulty</h3>
            <span className="muted small">{total} in pool</span>
          </div>
          <div className="tabs small">
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                className={difficulty === d ? 'tab active' : 'tab'}
                onClick={() => setDifficulty(d)}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Your progress</h3>
          </div>
          <div className="progress-grid">
            <div>
              <span className="stat-value">{progress.rating}</span>
              <span className="muted small">puzzle rating</span>
            </div>
            <div>
              <span className="stat-value">{progress.streak}</span>
              <span className="muted small">streak</span>
            </div>
            <div>
              <span className="stat-value">{progress.bestStreak}</span>
              <span className="muted small">best</span>
            </div>
          </div>
          <p className="muted small">
            {themeTitle(theme)}: {stats.solved} solved of {stats.attempted} attempted
          </p>
        </div>
      </div>
    </div>
  );
}
