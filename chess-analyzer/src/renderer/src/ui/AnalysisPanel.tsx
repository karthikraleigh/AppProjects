import type { GradedMove, PositionEval } from '@shared/types';
import { GRADE_META } from '@/analysis/constants';
import { pvToSan } from '@/analysis/grade';
import { formatEval, toWhiteCp } from '@/analysis/winprob';

interface Props {
  fen: string;
  evaluation: PositionEval | null;
  thinking: boolean;
  /** The graded move that led to this position, if we have one. */
  move?: GradedMove;
  onPlayUci: (uci: string) => void;
}

export function AnalysisPanel({ fen, evaluation, thinking, move, onPlayUci }: Props): React.JSX.Element {
  const sideToMove = (fen.split(' ')[1] ?? 'w') as 'w' | 'b';

  return (
    <div className="panel analysis-panel">
      <div className="panel-head">
        <h3>Engine</h3>
        {/* Show the depth reached so far while still searching: at high depth
            with several lines a search can run for a minute, and a bare
            "analysing…" looks indistinguishable from a hung engine. */}
        <span className="muted">
          {thinking
            ? evaluation?.depth
              ? `depth ${evaluation.depth}…`
              : 'analysing…'
            : evaluation
              ? `depth ${evaluation.depth}`
              : 'idle'}
        </span>
      </div>

      {move && (
        <div className="grade-box" style={{ borderColor: GRADE_META[move.grade].color }}>
          <div className="grade-title" style={{ color: GRADE_META[move.grade].color }}>
            {move.san} — {GRADE_META[move.grade].label}
          </div>
          {move.commentary && <p className="grade-text">{move.commentary}</p>}
        </div>
      )}

      <div className="lines">
        {evaluation?.lines.map((line) => {
          const cp = toWhiteCp(line, sideToMove);
          const sans = pvToSan(fen, line.pv, 8);
          const first = line.pv[0];
          return (
            <button
              key={line.multipv}
              className="line-row"
              onClick={() => first && onPlayUci(first)}
              title="Play this move"
            >
              <span className={`line-eval ${cp >= 0 ? 'pos' : 'neg'}`}>{formatEval(cp)}</span>
              <span className="line-pv">{sans.join(' ')}</span>
            </button>
          );
        })}
        {!evaluation?.lines.length && <p className="muted small">Waiting for the engine…</p>}
      </div>

      {evaluation?.lines[0]?.nps !== undefined && (
        <div className="engine-stats muted small">
          {Math.round((evaluation.lines[0].nps ?? 0) / 1000).toLocaleString()}k nodes/s
        </div>
      )}
    </div>
  );
}
