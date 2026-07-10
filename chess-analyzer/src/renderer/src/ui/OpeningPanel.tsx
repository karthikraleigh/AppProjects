import { useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { continuations, openingCount, searchOpenings, trapsNear, type Opening } from '@/openings/eco';

interface Props {
  fen: string;
  /** Most specific named opening reached so far, carried forward. */
  opening?: Opening;
  /** Ply at which the game left known theory, or 0 if still in book. */
  leftBookAtPly: number;
  /** Play a SAN move from the current position. */
  onPlay: (san: string) => void;
}

const plyToMove = (ply: number): string => {
  const no = Math.ceil(ply / 2);
  return ply % 2 === 1 ? `${no}.` : `${no}...`;
};

/**
 * Live opening identification, trap warnings, and a browsable explorer over the
 * bundled ECO database. Entirely offline -- lichess's explorer API returns 401.
 */
export function OpeningPanel({ fen, opening, leftBookAtPly, onPlay }: Props): React.JSX.Element {
  const [query, setQuery] = useState('');

  const traps = useMemo(() => trapsNear(fen), [fen]);
  const results = useMemo(() => (query ? searchOpenings(query, 40) : []), [query]);
  const total = useMemo(() => openingCount(), []);

  // Flag continuations that walk into a named trap.
  const nexts = useMemo(() => {
    const list = continuations(fen);
    return list.map((c) => {
      let danger: string | null = null;
      try {
        const probe = new Chess(fen);
        probe.move(c.san);
        danger = trapsNear(probe.fen())[0]?.name ?? null;
      } catch {
        /* ignore */
      }
      return { ...c, danger };
    });
  }, [fen]);

  return (
    <div className="panel opening-panel">
      <div className="panel-head">
        <h3>Opening</h3>
        <span className="muted">{total.toLocaleString()} lines</span>
      </div>

      {opening ? (
        <div className="opening-current">
          <span className="eco-badge">{opening.eco}</span>
          <span className="opening-name">{opening.name}</span>
        </div>
      ) : (
        <p className="muted small">No opening identified yet.</p>
      )}

      {leftBookAtPly > 0 && (
        <p className="muted small out-of-book">Left theory at {plyToMove(leftBookAtPly)}</p>
      )}

      {traps.length > 0 && (
        <div className="trap-warning">
          ⚠ Trap ahead: <b>{traps[0].name}</b>
          <span className="muted small">
            {' '}
            — {traps[0].pliesAway === 0 ? 'this is the trap position' : `${traps[0].pliesAway} ply away`}
          </span>
        </div>
      )}

      {nexts.length > 0 && (
        <>
          <h4 className="subhead">Book continuations</h4>
          <div className="continuations">
            {nexts.slice(0, 15).map((c) => {
              const label = c.opening?.name ?? `${c.weight} line${c.weight === 1 ? '' : 's'}`;
              return (
                <button
                  key={c.san}
                  className={`cont-btn ${c.danger ? 'danger' : ''}`}
                  onClick={() => onPlay(c.san)}
                  title={c.danger ? `Walks into the ${c.danger}` : `${label} — ${c.weight} book lines`}
                >
                  <b>
                    {c.san}
                    {c.danger ? ' ⚠' : ''}
                  </b>
                  <span className="cont-name">{label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <h4 className="subhead">Search openings</h4>
      <input
        className="text-input"
        placeholder="Sicilian, C50, King's Gambit…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="opening-results">
        {results.map((o) => (
          <div key={o.eco + o.name} className="opening-result">
            <span className="eco-badge small">{o.eco}</span>
            <span className="opening-name small">{o.name}</span>
            <span className="opening-moves">{o.moves.slice(0, 8).join(' ')}</span>
          </div>
        ))}
        {query && results.length === 0 && <p className="muted small">No match.</p>}
      </div>
    </div>
  );
}
