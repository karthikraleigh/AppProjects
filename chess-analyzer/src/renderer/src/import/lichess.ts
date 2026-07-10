import type { StoredGame } from '@shared/types';
import { parseGame, parseMultiGamePgn } from './pgn';

const PGN_ACCEPT = 'application/x-chess-pgn';

/**
 * Fetch a Lichess user's recent games as PGN.
 * The export endpoint streams concatenated PGNs; `parseMultiGamePgn` splits them.
 */
export async function fetchLichessGames(username: string, max = 20): Promise<StoredGame[]> {
  const user = username.trim();
  if (!user) return [];

  const url = `https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=${max}&clocks=false&evals=false&opening=true`;
  const text = await window.api.net.fetchText(url, PGN_ACCEPT);
  return parseMultiGamePgn(text, 'lichess');
}

/** Accepts a full Lichess URL or a bare 8-character game id. */
export async function fetchLichessGame(urlOrId: string): Promise<StoredGame | null> {
  const raw = urlOrId.trim();
  const id = raw.match(/lichess\.org\/([A-Za-z0-9]{8})/)?.[1] ?? (/^[A-Za-z0-9]{8}$/.test(raw) ? raw : null);
  if (!id) return null;

  const text = await window.api.net.fetchText(`https://lichess.org/game/export/${id}`, PGN_ACCEPT);
  return parseGame(text, 'lichess');
}
