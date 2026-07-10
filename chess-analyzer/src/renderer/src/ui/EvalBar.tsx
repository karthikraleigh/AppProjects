import { formatEval, winProb } from '@/analysis/winprob';

/** Vertical white-advantage bar beside the board. */
export function EvalBar({ cpWhite, flipped }: { cpWhite: number; flipped: boolean }): React.JSX.Element {
  const whiteShare = winProb(cpWhite) * 100;
  const label = formatEval(cpWhite);

  // The label sits inside White's slice of the bar. Which end that is depends on
  // the board orientation, so it has to flip with the fill.
  const whiteEnd = flipped ? 'top' : 'bottom';
  const labelOnWhite = cpWhite >= 0;

  return (
    <div className="evalbar" title={`Evaluation ${label}`}>
      <div className="evalbar-fill" style={{ height: `${whiteShare}%`, [whiteEnd]: 0 }} />
      <span
        className="evalbar-label"
        style={{
          [labelOnWhite ? whiteEnd : flipped ? 'bottom' : 'top']: 3,
          color: labelOnWhite ? '#2a2a2a' : '#f0ede4',
        }}
      >
        {label}
      </span>
    </div>
  );
}
