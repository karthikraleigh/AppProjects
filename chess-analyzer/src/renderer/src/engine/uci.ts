import type { InfoLine } from '@shared/types';

/**
 * Parse a UCI `info` line.
 *
 * Returns null for lines without a score (`info depth 1 currmove ...`,
 * `info string ...`), which the engine emits constantly and which carry no
 * evaluation.
 */
export function parseInfo(line: string): InfoLine | null {
  if (!line.startsWith('info ')) return null;
  if (line.startsWith('info string')) return null;

  const tok = line.split(/\s+/);
  let depth: number | undefined;
  let seldepth: number | undefined;
  let multipv = 1;
  let cp: number | undefined;
  let mate: number | undefined;
  let nodes: number | undefined;
  let nps: number | undefined;
  let timeMs: number | undefined;
  let pv: string[] = [];

  for (let i = 1; i < tok.length; i++) {
    switch (tok[i]) {
      case 'depth':
        depth = Number(tok[++i]);
        break;
      case 'seldepth':
        seldepth = Number(tok[++i]);
        break;
      case 'multipv':
        multipv = Number(tok[++i]);
        break;
      case 'nodes':
        nodes = Number(tok[++i]);
        break;
      case 'nps':
        nps = Number(tok[++i]);
        break;
      case 'time':
        timeMs = Number(tok[++i]);
        break;
      case 'score':
        if (tok[i + 1] === 'cp') {
          cp = Number(tok[i + 2]);
          i += 2;
        } else if (tok[i + 1] === 'mate') {
          mate = Number(tok[i + 2]);
          i += 2;
        }
        break;
      case 'pv':
        pv = tok.slice(i + 1);
        i = tok.length;
        break;
      default:
        break;
    }
  }

  if (depth === undefined) return null;
  if (cp === undefined && mate === undefined) return null;

  return { depth, seldepth, multipv, cp, mate, nodes, nps, timeMs, pv };
}

export function parseBestMove(line: string): string | null {
  if (!line.startsWith('bestmove')) return null;
  const m = line.split(/\s+/)[1];
  return m && m !== '(none)' ? m : null;
}
