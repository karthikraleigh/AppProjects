import { Chess } from 'chess.js';
import type { GameMeta, StoredGame } from '@shared/types';

function tag(pgn: string, name: string): string | undefined {
  const m = pgn.match(new RegExp(`\\[${name}\\s+"([^"]*)"\\]`));
  return m?.[1];
}

/** FNV-1a. Only used to derive a stable id; collisions merely dedupe two games. */
function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * A stable id for a game, so re-importing it doesn't duplicate the library entry.
 *
 * chess.com's `Site` is the literal string "Chess.com" -- the game id is in
 * `Link`. Lichess puts it in `Site`. Anything else falls back to hashing the
 * PGN, which is stable across imports where a timestamp+counter was not.
 */
function makeId(pgn: string): string {
  for (const name of ['Link', 'Site']) {
    const value = tag(pgn, name) ?? '';
    const found = value.match(/([A-Za-z0-9]{8,})\/?$/)?.[1];
    if (found) return found;
  }
  return `pgn-${hash(pgn)}`;
}

/** Validate a PGN by replaying it. Returns null if it isn't a playable game. */
export function parseGame(pgn: string, source: GameMeta['source']): StoredGame | null {
  const trimmed = pgn.trim();
  if (!trimmed) return null;

  const game = new Chess();
  try {
    game.loadPgn(trimmed);
  } catch {
    return null;
  }
  if (game.history().length === 0) return null;

  const meta: GameMeta = {
    id: makeId(trimmed),
    white: tag(trimmed, 'White') ?? 'White',
    black: tag(trimmed, 'Black') ?? 'Black',
    result: tag(trimmed, 'Result') ?? '*',
    date: tag(trimmed, 'UTCDate') ?? tag(trimmed, 'Date'),
    event: tag(trimmed, 'Event'),
    site: tag(trimmed, 'Site'),
    whiteElo: tag(trimmed, 'WhiteElo'),
    blackElo: tag(trimmed, 'BlackElo'),
    source,
  };

  return { meta, pgn: trimmed };
}

/**
 * Split a multi-game PGN file. Games are separated by a blank line followed by
 * a new `[Event ...]` tag; splitting on that boundary is what standard readers do.
 */
export function parseMultiGamePgn(text: string, source: GameMeta['source'] = 'pgn'): StoredGame[] {
  const chunks = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n(?=\[Event )/g)
    .map((c) => c.trim())
    .filter(Boolean);

  const games: StoredGame[] = [];
  for (const chunk of chunks) {
    const parsed = parseGame(chunk, source);
    if (parsed) games.push(parsed);
  }
  return games;
}
