import type { StoredGame } from '@shared/types';

interface Props {
  games: StoredGame[];
  onLoad: (game: StoredGame) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

const SOURCE_LABEL: Record<StoredGame['meta']['source'], string> = {
  'chess.com': 'chess.com',
  lichess: 'lichess',
  pgn: 'PGN',
};

/** Games saved to disk (userData/library.json). Survives restarts, works offline. */
export function LibraryPanel({ games, onLoad, onDelete, onClear }: Props): React.JSX.Element {
  return (
    <div className="panel library-panel">
      <div className="panel-head">
        <h3>Saved games</h3>
        {games.length > 0 ? (
          <button className="ghost small" onClick={onClear}>
            clear all
          </button>
        ) : (
          <span className="muted small">none yet</span>
        )}
      </div>

      {games.length === 0 && (
        <p className="muted small">Imported games are saved here and stay available offline.</p>
      )}

      <div className="game-list">
        {games.map((g) => (
          <div key={g.meta.id} className="game-row saved">
            <button className="game-row-main" onClick={() => onLoad(g)}>
              <span className="game-players">
                {g.meta.white} vs {g.meta.black}
              </span>
              <span className="muted small">
                {g.meta.result} · {g.meta.date ?? '—'} · {SOURCE_LABEL[g.meta.source]}
              </span>
            </button>
            <button className="ghost small delete" title="Remove" onClick={() => onDelete(g.meta.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
