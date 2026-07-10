import { useEffect, useState } from 'react';
import type { StoredGame } from '@shared/types';
import { fetchChessComGames } from '@/import/chesscom';
import { fetchLichessGame, fetchLichessGames } from '@/import/lichess';
import { parseMultiGamePgn } from '@/import/pgn';

interface Props {
  onLoad: (game: StoredGame) => void;
}

type Source = 'chess.com' | 'lichess' | 'pgn';

export function ImportPanel({ onLoad }: Props): React.JSX.Element {
  const [source, setSource] = useState<Source>('chess.com');
  const [username, setUsername] = useState('');
  const [pgnText, setPgnText] = useState('');
  const [games, setGames] = useState<StoredGame[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // navigator.onLine read once never updates; the badge would lie after the
  // connection drops.
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = (): void => setOnline(true);
    const down = (): void => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setGames([]);
    try {
      if (source === 'pgn') {
        const parsed = parseMultiGamePgn(pgnText, 'pgn');
        if (!parsed.length) throw new Error('No valid games found in that PGN.');
        setGames(parsed);
      } else if (source === 'chess.com') {
        setGames(await fetchChessComGames(username, 20));
      } else {
        // Accept either a username or a direct game link.
        const single = username.includes('lichess.org/') ? await fetchLichessGame(username) : null;
        setGames(single ? [single] : await fetchLichessGames(username, 20));
      }
    } catch (err) {
      const msg = (err as Error).message.replace(/^Error invoking remote method '[^']+':\s*/, '');
      setError(online ? msg : 'You are offline. Paste a PGN to analyse without a connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel import-panel">
      <div className="panel-head">
        <h3>Import</h3>
        <span className={online ? 'muted' : 'offline-badge'}>{online ? 'online' : 'offline'}</span>
      </div>

      <div className="tabs small">
        {(['chess.com', 'lichess', 'pgn'] as Source[]).map((s) => (
          <button key={s} className={source === s ? 'tab active' : 'tab'} onClick={() => setSource(s)}>
            {s}
          </button>
        ))}
      </div>

      {source === 'pgn' ? (
        <textarea
          className="pgn-input"
          rows={8}
          placeholder="Paste PGN here…"
          value={pgnText}
          onChange={(e) => setPgnText(e.target.value)}
        />
      ) : (
        <input
          className="text-input"
          placeholder={source === 'chess.com' ? 'chess.com username' : 'lichess username or game URL'}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void run()}
        />
      )}

      {source !== 'pgn' && !online && (
        <p className="muted small">Offline — only PGN import is available right now.</p>
      )}

      <button className="primary" disabled={busy} onClick={() => void run()}>
        {busy ? 'Fetching…' : 'Fetch games'}
      </button>

      {error && <p className="error small">{error}</p>}

      <div className="game-list">
        {games.map((g) => (
          <button key={g.meta.id} className="game-row" onClick={() => onLoad(g)}>
            <span className="game-players">
              {g.meta.white} vs {g.meta.black}
            </span>
            <span className="muted small">
              {g.meta.result} · {g.meta.date ?? ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
