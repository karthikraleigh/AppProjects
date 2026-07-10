import { useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { PuzzlePoolStatus, PuzzleProgress } from '@shared/types';
import { EXTRA_THEMES, LESSONS, type Lesson } from '@shared/tactics';
import { themeStats } from '@/puzzles/rating';
import { PlayableBoard } from '@/ui/PlayableBoard';

interface Props {
  progress: PuzzleProgress;
  pool: PuzzlePoolStatus | null;
  onPractice: (theme: string) => void;
}

/** Positions after each step of a lesson, plus the arrow for the move to come. */
function useLessonLine(lesson: Lesson): { fens: string[]; arrows: Array<Array<{ startSquare: string; endSquare: string; color: string }>> } {
  return useMemo(() => {
    const game = new Chess(lesson.fen);
    const fens = [lesson.fen];
    const arrows: Array<Array<{ startSquare: string; endSquare: string; color: string }>> = [];

    for (const step of lesson.steps) {
      let move;
      try {
        move = game.move(step.san);
      } catch {
        break; // verify-lessons.mjs guards against this
      }
      arrows.push([{ startSquare: move.from, endSquare: move.to, color: '#e8a33d' }]);
      fens.push(game.fen());
    }
    arrows.push([]); // no arrow once the line is finished
    return { fens, arrows };
  }, [lesson]);
}

function LessonView({ lesson, onPractice, solved, attempted }: {
  lesson: Lesson;
  onPractice: () => void;
  solved: number;
  attempted: number;
}): React.JSX.Element {
  const [step, setStep] = useState(0);
  const { fens, arrows } = useLessonLine(lesson);

  const atEnd = step >= lesson.steps.length;
  const currentNote = atEnd ? null : lesson.steps[step].note;
  const orientation = lesson.fen.split(' ')[1] === 'b' ? 'black' : 'white';

  return (
    <div className="learn-lesson">
      <div className="board-column">
        <div className="board-wrap">
          <div className="board">
            <PlayableBoard
              fen={fens[Math.min(step, fens.length - 1)]}
              orientation={orientation}
              arrows={arrows[Math.min(step, arrows.length - 1)]}
              interactive={false}
            />
          </div>
        </div>
        <div className="controls">
          <button onClick={() => setStep(0)} disabled={step === 0}>
            ⏮
          </button>
          <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            ◀
          </button>
          <span className="eval-readout">
            {Math.min(step + 1, lesson.steps.length)} / {lesson.steps.length}
          </span>
          <button onClick={() => setStep((s) => Math.min(lesson.steps.length, s + 1))} disabled={atEnd}>
            ▶
          </button>
          <button className="primary" onClick={onPractice}>
            Practice this →
          </button>
        </div>
      </div>

      <div className="side-column">
        <div className="panel">
          <div className="panel-head">
            <h3>{lesson.title}</h3>
            <span className="muted small">
              {solved}/{attempted || 0} solved
            </span>
          </div>
          <p className="lesson-text">{lesson.explanation}</p>
          <p className="lesson-cue">
            <b>What to look for:</b> {lesson.cue}
          </p>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Worked example</h3>
            <span className="muted small">engine-verified</span>
          </div>
          {atEnd ? (
            <p className="muted small">
              That’s the idea. Now find it yourself — the practice puzzles all contain this motif.
            </p>
          ) : (
            <>
              <div className="lesson-move">{lesson.steps[step].san}</div>
              <p className="lesson-text">{currentNote}</p>
            </>
          )}
          <div className="lesson-line">
            {lesson.steps.map((s, i) => (
              <button
                key={i}
                className={`line-step ${i === step ? 'active' : ''}`}
                onClick={() => setStep(i)}
              >
                {s.san}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LearnMode({ progress, pool, onPractice }: Props): React.JSX.Element {
  const [openAngle, setOpenAngle] = useState<string | null>(null);
  const lesson = LESSONS.find((l) => l.angle === openAngle) ?? null;

  if (lesson) {
    const stats = themeStats(progress, lesson.angle);
    return (
      <div className="learn-wrap">
        <div className="learn-back">
          <button className="ghost small" onClick={() => setOpenAngle(null)}>
            ← All tactics
          </button>
        </div>
        <LessonView
          lesson={lesson}
          solved={stats.solved}
          attempted={stats.attempted}
          onPractice={() => onPractice(lesson.angle)}
        />
      </div>
    );
  }

  return (
    <div className="learn-index">
      <div className="panel">
        <div className="panel-head">
          <h3>Tactics</h3>
          <span className="muted small">{pool ? `${pool.total} puzzles offline` : 'loading…'}</span>
        </div>
        <div className="lesson-grid">
          {LESSONS.map((l) => {
            const stats = themeStats(progress, l.angle);
            const available = pool?.byTheme[l.angle] ?? 0;
            const mastery = stats.attempted ? Math.round((stats.solved / stats.attempted) * 100) : 0;
            return (
              <button key={l.angle} className="lesson-card" onClick={() => setOpenAngle(l.angle)}>
                <span className="lesson-card-title">{l.title}</span>
                <span className="lesson-card-blurb">{l.cue}</span>
                <span className="lesson-card-foot muted small">
                  {stats.attempted ? `${stats.solved}/${stats.attempted} · ${mastery}%` : 'not started'}
                  {' · '}
                  {available} puzzles
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>More practice themes</h3>
          <span className="muted small">no lesson, puzzles only</span>
        </div>
        <div className="theme-chips">
          {EXTRA_THEMES.map((t) => {
            const stats = themeStats(progress, t.angle);
            const available = pool?.byTheme[t.angle] ?? 0;
            return (
              <button
                key={t.angle}
                className="theme-chip button"
                onClick={() => onPractice(t.angle)}
                disabled={!available}
                title={available ? `${available} puzzles` : 'no puzzles imported yet'}
              >
                {t.title}
                <span className="muted"> {stats.solved > 0 ? `· ${stats.solved}` : ''}</span>
              </button>
            );
          })}
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
            <span className="muted small">best streak</span>
          </div>
        </div>
      </div>
    </div>
  );
}
