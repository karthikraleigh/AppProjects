import { useEffect, useRef } from 'react';
import type { GradedMove } from '@shared/types';
import { GRADE_META } from '@/analysis/constants';

interface Props {
  moves: GradedMove[];
  currentPly: number;
  onSelect: (ply: number) => void;
}

export function MoveList({ moves, currentPly, onSelect }: Props): React.JSX.Element {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentPly]);

  // Group plies into full moves so the list reads like a scoresheet.
  const rows: Array<{ no: number; white?: GradedMove; black?: GradedMove }> = [];
  for (const m of moves) {
    const no = Math.ceil(m.ply / 2);
    let row = rows[rows.length - 1];
    if (!row || row.no !== no) {
      row = { no };
      rows.push(row);
    }
    if (m.color === 'w') row.white = m;
    else row.black = m;
  }

  const cell = (m?: GradedMove): React.JSX.Element => {
    if (!m) return <span className="move-cell empty" />;
    const meta = GRADE_META[m.grade];
    const active = m.ply === currentPly;
    return (
      <button
        ref={active ? activeRef : undefined}
        className={`move-cell ${active ? 'active' : ''}`}
        onClick={() => onSelect(m.ply)}
        title={m.commentary}
      >
        <span className="move-san">{m.san}</span>
        {meta.symbol && (
          <span className="move-symbol" style={{ color: meta.color }}>
            {meta.symbol}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="movelist">
      {rows.map((row) => (
        <div className="move-row" key={row.no}>
          <span className="move-no">{row.no}.</span>
          {cell(row.white)}
          {cell(row.black)}
        </div>
      ))}
      {moves.length === 0 && <p className="empty-hint">Make a move, or import a game to review.</p>}
    </div>
  );
}
