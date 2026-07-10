import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import {
  DEFAULT_ENGINE_OPTIONS,
  DEFAULT_PROGRESS,
  type EngineOptions,
  type GradedMove,
  type PuzzlePoolStatus,
  type PuzzleProgress,
  type ReviewProgress,
  type StoredGame,
} from '@shared/types';
import type { PositionEval } from '@shared/types';
import { getEngine } from '@/engine/client';
import { useAnalysis } from '@/engine/useAnalysis';
import { buildPlyInfos, gradeFromInfo, placeholderMove } from '@/analysis/liveGrade';
import { parseGame } from '@/import/pgn';
import { classifyGame, isBookPosition } from '@/openings/eco';
import { LibraryPanel } from '@/ui/LibraryPanel';
import { reviewCacheKey, reviewGame, type ReviewedGame } from '@/analysis/review';
import { formatEval, toWhiteCp } from '@/analysis/winprob';
import { GRADE_META } from '@/analysis/constants';
import { AnalysisPanel } from '@/ui/AnalysisPanel';
import { EvalBar } from '@/ui/EvalBar';
import { EvalGraph } from '@/ui/EvalGraph';
import { ImportPanel } from '@/ui/ImportPanel';
import { LearnMode } from '@/ui/LearnMode';
import { MoveList } from '@/ui/MoveList';
import { OpeningPanel } from '@/ui/OpeningPanel';
import { PlayableBoard } from '@/ui/PlayableBoard';
import { PuzzleMode } from '@/ui/PuzzleMode';
import { Settings } from '@/ui/Settings';

type Tab = 'analyse' | 'learn' | 'puzzles' | 'import' | 'settings';
const TABS: Tab[] = ['analyse', 'learn', 'puzzles', 'import', 'settings'];

const START_FEN = new Chess().fen();

export function App(): React.JSX.Element {
  const [options, setOptions] = useState<EngineOptions>(DEFAULT_ENGINE_OPTIONS);
  const [tab, setTab] = useState<Tab>('analyse');
  const [flipped, setFlipped] = useState(false);

  // The live board the user plays on.
  const [history, setHistory] = useState<string[]>([]); // SAN moves
  const [cursor, setCursor] = useState(0); // plies shown, 0 = start

  // A reviewed game, when one is loaded.
  const [review, setReview] = useState<ReviewedGame | null>(null);
  const [progress, setProgress] = useState<ReviewProgress | null>(null);
  const [loadedGame, setLoadedGame] = useState<StoredGame | null>(null);
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  // ---- saved-game library (userData/library.json) ------------------------
  const [library, setLibrary] = useState<StoredGame[]>([]);
  const libraryLoaded = useRef(false);

  useEffect(() => {
    void window.api.settings.get().then(setOptions);
    void window.api.library.list().then((games) => {
      setLibrary(games);
      libraryLoaded.current = true;
    });
  }, []);

  // Persist on change, but never before the first load completes -- that would
  // overwrite the stored library with the initial empty array.
  useEffect(() => {
    if (libraryLoaded.current) void window.api.library.save(library);
  }, [library]);

  const saveToLibrary = useCallback((game: StoredGame) => {
    setLibrary((prev) =>
      prev.some((g) => g.meta.id === game.meta.id) ? prev : [game, ...prev].slice(0, 200),
    );
  }, []);

  const deleteFromLibrary = useCallback((id: string) => {
    setLibrary((prev) => prev.filter((g) => g.meta.id !== id));
  }, []);

  // ---- puzzles + tactics progress ---------------------------------------
  const [pool, setPool] = useState<PuzzlePoolStatus | null>(null);
  const [puzzleProgress, setPuzzleProgress] = useState<PuzzleProgress>(DEFAULT_PROGRESS);
  const [practiceTheme, setPracticeTheme] = useState<string>('fork');

  useEffect(() => {
    void window.api.puzzles.status().then(setPool);
    void window.api.progress.get().then(setPuzzleProgress);
    // Main runs the daily import in the background and tells us when it lands.
    return window.api.puzzles.onImported(setPool);
  }, []);

  const saveProgress = useCallback((next: PuzzleProgress) => {
    setPuzzleProgress(next);
    void window.api.progress.set(next);
  }, []);

  const importPuzzles = useCallback(() => {
    setPool((prev) => (prev ? { ...prev, importing: true } : prev));
    void window.api.puzzles.import().then(setPool);
  }, []);

  const startPractice = useCallback((theme: string) => {
    setPracticeTheme(theme);
    setTab('puzzles');
  }, []);

  // Sliders fire on every tick. Update the UI immediately, but debounce the
  // disk write (and the engine `setoption` it triggers) so dragging one doesn't
  // rewrite settings.json dozens of times.
  const persistTimer = useRef<number | null>(null);
  const persistOptions = useCallback((next: EngineOptions) => {
    setOptions(next);
    if (persistTimer.current !== null) clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      persistTimer.current = null;
      void window.api.settings.set(next);
    }, 300);
  }, []);

  useEffect(
    () => () => {
      if (persistTimer.current !== null) clearTimeout(persistTimer.current);
    },
    [],
  );

  // Position currently on the board.
  const { fen, legalSans } = useMemo(() => {
    const game = new Chess();
    for (const san of history.slice(0, cursor)) {
      try {
        game.move(san);
      } catch {
        break;
      }
    }
    return { fen: game.fen(), legalSans: game.moves() };
  }, [history, cursor]);

  // Evaluations gathered while playing, keyed by FEN. Grading a move needs the
  // eval of the position before it *and* after it, so we accumulate them and
  // always keep the deepest one seen.
  const evalCache = useRef(new Map<string, PositionEval>());
  const dirtyFens = useRef(new Set<string>());
  const [liveGrades, setLiveGrades] = useState<Record<number, GradedMove>>({});
  const [evalVersion, setEvalVersion] = useState(0);

  const cacheEval = useCallback((next: PositionEval) => {
    const prev = evalCache.current.get(next.fen);
    if (prev && prev.depth >= next.depth) return;
    evalCache.current.set(next.fen, next);
    dirtyFens.current.add(next.fen);
    setEvalVersion((v) => v + 1);
  }, []);

  const { evaluation, thinking } = useAnalysis(fen, options.liveDepth, options.multipv, cacheEval);

  const sideToMove = (fen.split(' ')[1] ?? 'w') as 'w' | 'b';
  const cpWhite = evaluation?.lines[0] ? toWhiteCp(evaluation.lines[0], sideToMove) : 0;

  // One replay per history, not one per ply per engine update.
  const plyInfos = useMemo(() => buildPlyInfos(history), [history]);

  useEffect(() => {
    if (review) return;
    const dirty = dirtyFens.current;
    if (dirty.size === 0) return;
    dirtyFens.current = new Set();

    // Only re-grade plies whose endpoints just changed. A deeper eval arriving
    // later can still overturn a verdict, so grades are never frozen at
    // whatever depth happened to be ready first.
    setLiveGrades((prev) => {
      const next = { ...prev };
      let changed = false;

      for (const info of plyInfos) {
        if (!dirty.has(info.fenBefore) && !dirty.has(info.fenAfter)) continue;
        const graded = gradeFromInfo(info, evalCache.current);
        if (!graded) continue;
        const old = next[info.ply];
        if (!old || old.grade !== graded.grade || old.evalAfterCp !== graded.evalAfterCp) {
          next[info.ply] = graded;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [evalVersion, plyInfos, review]);

  const liveMoves: GradedMove[] = useMemo(
    () => history.map((san, i) => liveGrades[i + 1] ?? placeholderMove(san, i + 1)),
    [history, liveGrades],
  );

  // Opening classification over the moves shown so far (respects the cursor, so
  // stepping back through a game re-reports the opening at that point).
  //
  // The reported departure is the start of the *current* out-of-book stretch,
  // not the first one ever: an unusual move order can leave theory and
  // transpose straight back, and blaming that earlier move would be wrong.
  const { opening: currentOpening, leftBookAtPly } = useMemo(() => {
    const infos = plyInfos.slice(0, cursor);
    const result = classifyGame(infos.map((p) => p.fenAfter));

    const last = infos[infos.length - 1];
    let since = 0;
    if (last && !isBookPosition(last.fenAfter)) {
      since = 1;
      for (let i = infos.length - 2; i >= 0; i--) {
        if (isBookPosition(infos[i].fenAfter)) {
          since = i + 2;
          break;
        }
      }
    }
    return { opening: result.opening, leftBookAtPly: since };
  }, [plyInfos, cursor]);

  const currentMove: GradedMove | undefined = review?.moves[cursor - 1] ?? liveGrades[cursor];

  const playSan = useCallback(
    (san: string) => {
      // Validate against the current position. An illegal SAN appended here
      // would silently truncate the FEN replay and kill grading for every
      // later ply, with no visible error.
      const probe = new Chess(fen);
      let legal;
      try {
        legal = probe.move(san);
      } catch {
        return;
      }

      setHistory((h) => [...h.slice(0, cursor), legal.san]);
      setCursor((c) => c + 1);
      // Playing from a mid-game position discards everything after it.
      setLiveGrades((prev) => {
        const next: Record<number, GradedMove> = {};
        for (const [ply, move] of Object.entries(prev)) {
          if (Number(ply) <= cursor) next[Number(ply)] = move;
        }
        return next;
      });
      // Diverging from a loaded game invalidates its review.
      setReview(null);
      setLoadedGame(null);
    },
    [cursor, fen],
  );

  /** Play from-square to to-square. Returns false if the move is illegal. */
  const playMove = useCallback(
    (from: string, to: string, promotion = 'q'): boolean => {
      const game = new Chess(fen);
      try {
        const move = game.move({ from, to, promotion });
        playSan(move.san);
        return true;
      } catch {
        return false;
      }
    },
    [fen, playSan],
  );

  const playUci = useCallback(
    (uci: string) => {
      playMove(uci.slice(0, 2), uci.slice(2, 4), uci.slice(4, 5) || 'q');
    },
    [playMove],
  );

  // Click-to-move and drag both live in PlayableBoard, shared with puzzle mode.
  const onBoardMove = useCallback(
    (from: string, to: string, promotion: string) => playMove(from, to, promotion),
    [playMove],
  );

  // ---- Review ------------------------------------------------------------
  const runReview = useCallback(
    async (game: StoredGame) => {
      cancelRef.current = { cancelled: false };
      setReview(null);
      setProgress({ done: 0, total: 1, phase: 'shallow' });
      setLoadedGame(game);
      saveToLibrary(game);
      setTab('analyse');

      const chess = new Chess();
      chess.loadPgn(game.pgn);
      setHistory(chess.history());
      setCursor(0);

      const key = reviewCacheKey(game.pgn, options);
      const cached = await window.api.cache.get<ReviewedGame>(key);
      if (cached) {
        setReview(cached);
        setProgress(null);
        return;
      }

      try {
        const result = await reviewGame({
          pgn: game.pgn,
          engine: getEngine(),
          options,
          signal: cancelRef.current,
          onProgress: setProgress,
        });
        setReview(result);
        void window.api.cache.set(key, result);
      } catch (err) {
        if ((err as Error).message !== 'cancelled') console.error(err);
      } finally {
        setProgress(null);
      }
    },
    [options, saveToLibrary],
  );

  const cancelReview = (): void => {
    cancelRef.current.cancelled = true;
    setProgress(null);
  };

  // Verification harness only: drive the app from a script. Signalled by the
  // renderer URL, which main sets when CHESS_SHOT is present.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('testhook')) return;
    const w = window as unknown as {
      __playSan?: (san: string) => void;
      __loadPgn?: (pgn: string) => void;
      __state?: () => unknown;
      __gameId?: (pgn: string) => string | null;
    };
    w.__playSan = playSan;
    w.__gameId = (pgn: string) => parseGame(pgn, 'pgn')?.meta.id ?? null;
    w.__loadPgn = (pgn: string) => {
      const parsed = parseGame(pgn, 'pgn');
      if (parsed) void runReview(parsed);
    };
    w.__state = () => ({
      reviewed: review !== null,
      moveCount: review?.moves.length ?? history.length,
      accuracy: review?.accuracy ?? null,
      progress,
      grades: review?.moves.map((m) => m.grade) ?? [],
      leftBookAtPly,
      librarySize: library.length,
      libraryIds: library.map((g) => g.meta.id),
      // Enough to verify the first out-of-book move was graded against a real
      // engine eval rather than a phantom 0.00.
      reviewMoves:
        review?.moves.map((m) => ({
          ply: m.ply,
          san: m.san,
          grade: m.grade,
          bestSan: m.bestSan ?? null,
          evalAfterCp: m.evalAfterCp,
        })) ?? [],
    });
  }, [playSan, runReview, review, history.length, progress, leftBookAtPly, library]);

  // ---- Keyboard navigation (analysis board only) ------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (tab !== 'analyse') return; // don't hijack arrows in learn/puzzle mode
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') setCursor((c) => Math.max(0, c - 1));
      if (e.key === 'ArrowRight') setCursor((c) => Math.min(history.length, c + 1));
      if (e.key === 'Home') setCursor(0);
      if (e.key === 'End') setCursor(history.length);
      if (e.key === 'f') setFlipped((f) => !f);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history.length, tab]);

  // Arrow for the engine's best move.
  const arrows = useMemo(() => {
    const best = evaluation?.bestMove ?? evaluation?.lines[0]?.pv[0];
    if (!best || best.length < 4) return [];
    return [{ startSquare: best.slice(0, 2), endSquare: best.slice(2, 4), color: '#e8a33d' }];
  }, [evaluation]);

  // Only plot plies we actually have an evaluation for, or the graph reads as a
  // flat line at 0.0 for anything not yet analysed.
  const graphMoves = review?.moves ?? liveMoves.filter((m) => m.fenAfter !== '');

  return (
    <div className="app">
      <header className="topbar">
        <h1>Chess Analyzer</h1>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          {loadedGame && (
            <span className="muted small">
              {loadedGame.meta.white} vs {loadedGame.meta.black}
            </span>
          )}
          <button className="ghost" onClick={() => setFlipped((f) => !f)} title="Flip board (f)">
            ⇅
          </button>
        </div>
      </header>

      {tab === 'learn' && (
        <main className="layout-full">
          <LearnMode progress={puzzleProgress} pool={pool} onPractice={startPractice} />
        </main>
      )}

      {tab === 'puzzles' && (
        <main className="layout-full">
          <PuzzleMode
            theme={practiceTheme}
            progress={puzzleProgress}
            onProgress={saveProgress}
            pool={pool}
            onImport={importPuzzles}
            onBack={() => setTab('learn')}
          />
        </main>
      )}

      {/* Unmounted, not hidden: a second live board would duplicate every
          `data-square` and keep the analysis engine busy while you solve. */}
      {tab !== 'learn' && tab !== 'puzzles' && (
      <main className="layout">
        <section className="board-column">
          <div className="board-wrap">
            <EvalBar cpWhite={cpWhite} flipped={flipped} />
            <div className="board">
              <PlayableBoard
                fen={fen}
                onMove={onBoardMove}
                orientation={flipped ? 'black' : 'white'}
                arrows={arrows}
              />
            </div>
          </div>

          <div className="controls">
            <button onClick={() => setCursor(0)} disabled={cursor === 0}>
              ⏮
            </button>
            <button onClick={() => setCursor((c) => Math.max(0, c - 1))} disabled={cursor === 0}>
              ◀
            </button>
            <span className="eval-readout">{formatEval(cpWhite)}</span>
            <button
              onClick={() => setCursor((c) => Math.min(history.length, c + 1))}
              disabled={cursor >= history.length}
            >
              ▶
            </button>
            <button onClick={() => setCursor(history.length)} disabled={cursor >= history.length}>
              ⏭
            </button>
            <button
              className="ghost"
              onClick={() => {
                setHistory([]);
                setCursor(0);
                setReview(null);
                setLoadedGame(null);
                setLiveGrades({});
              }}
            >
              reset
            </button>
          </div>

          {review && (
            <div className="accuracy-row">
              <span>
                White accuracy <b>{review.accuracy.white}%</b>
              </span>
              <span>
                Black accuracy <b>{review.accuracy.black}%</b>
              </span>
            </div>
          )}

          {progress && (
            <div className="progress">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
                />
              </div>
              <span className="muted small">
                {progress.phase === 'shallow' ? 'Scanning' : 'Deep analysis'} {progress.done}/{progress.total}
              </span>
              <button className="ghost small" onClick={cancelReview}>
                cancel
              </button>
            </div>
          )}

          {graphMoves.length > 0 && (
            <EvalGraph moves={graphMoves} currentPly={cursor} onSeek={setCursor} />
          )}
        </section>

        <section className="side-column">
          {tab === 'analyse' && (
            <>
              <AnalysisPanel
                fen={fen}
                evaluation={evaluation}
                thinking={thinking}
                move={currentMove}
                onPlayUci={playUci}
              />
              <div className="panel">
                <div className="panel-head">
                  <h3>Moves</h3>
                  {loadedGame && !review && !progress && (
                    <button className="ghost small" onClick={() => void runReview(loadedGame)}>
                      review game
                    </button>
                  )}
                </div>
                <MoveList moves={review?.moves ?? liveMoves} currentPly={cursor} onSelect={setCursor} />
              </div>
              <OpeningPanel
                fen={fen}
                opening={currentOpening}
                leftBookAtPly={leftBookAtPly}
                onPlay={(san) => legalSans.includes(san) && playSan(san)}
              />
            </>
          )}

          {tab === 'import' && (
            <>
              <ImportPanel onLoad={(g) => void runReview(g)} />
              <LibraryPanel
                games={library}
                onLoad={(g) => void runReview(g)}
                onDelete={deleteFromLibrary}
                onClear={() => setLibrary([])}
              />
            </>
          )}
          {tab === 'settings' && <Settings options={options} onChange={persistOptions} />}
        </section>
      </main>
      )}

      <footer className="statusbar">
        <span className="muted small">
          Stockfish 18 · {options.build === 'single' ? 'full net' : 'lite'} · depth {options.liveDepth} ·{' '}
          {options.multipv} lines
        </span>
        {currentMove && (
          <span className="small" style={{ color: GRADE_META[currentMove.grade].color }}>
            {GRADE_META[currentMove.grade].label}
          </span>
        )}
      </footer>
    </div>
  );
}
