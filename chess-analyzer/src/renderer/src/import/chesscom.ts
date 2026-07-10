import type { StoredGame } from '@shared/types';
import { parseGame } from './pgn';

interface ChessComGame {
  pgn?: string;
  rules?: string;
  time_class?: string;
}

/**
 * Fetch a player's recent games from chess.com.
 *
 * The public API is unversioned and has no auth. It exposes monthly archives;
 * we walk them newest-first until we have enough games.
 *
 * Variants (chess960, bughouse, ...) are filtered out via `rules`, since the
 * analyzer only understands standard chess.
 */
export async function fetchChessComGames(username: string, max = 20): Promise<StoredGame[]> {
  const user = username.trim().toLowerCase();
  if (!user) return [];

  const archivesRaw = await window.api.net.fetchText(
    `https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`,
  );
  const archives: string[] = JSON.parse(archivesRaw).archives ?? [];

  const games: StoredGame[] = [];
  for (const url of archives.slice().reverse()) {
    if (games.length >= max) break;

    const monthRaw = await window.api.net.fetchText(url);
    const monthly: ChessComGame[] = JSON.parse(monthRaw).games ?? [];

    for (const g of monthly.slice().reverse()) {
      if (games.length >= max) break;
      if (g.rules !== 'chess' || !g.pgn) continue;
      const parsed = parseGame(g.pgn, 'chess.com');
      if (parsed) games.push(parsed);
    }
  }
  return games;
}
