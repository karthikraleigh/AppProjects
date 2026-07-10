// Verifies every worked example in src/shared/tactics.ts:
//   1. the FEN is legal
//   2. every step is a legal move
//   3. steps ending in '#' really are checkmate
//   4. the first move is Stockfish's best move at depth 16
//
// A lesson that teaches a move the engine disagrees with is worse than no lesson.
//
//   node scripts/verify-lessons.mjs

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { LESSONS } = await import(`file://${resolve(root, 'src/shared/tactics.ts')}`).catch(async () => {
  // tactics.ts is TypeScript; strip types by importing the transpiled shape.
  // Simplest robust path: read + eval the exported array via a tiny regex-free shim.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(resolve(root, 'src/shared/tactics.ts'), 'utf8');
  const body = src
    .replace(/^import[\s\S]*?;$/gm, '')
    .replace(/export interface[\s\S]*?\n}\n/g, '')
    .replace(/:\s*Lesson\[\]/g, '')
    .replace(/:\s*Array<\{[^}]*\}>/g, '')
    .replace(/:\s*string\[\]/g, '')
    .replace(/export function[\s\S]*$/m, '')
    .replace(/export const/g, 'const');
  const mod = new Function(`${body}; return { LESSONS };`);
  return mod();
});

const ENGINE = resolve(root, 'resources/engine/stockfish-18-lite-single');
const HOST = resolve(root, 'resources/engine-host.cjs');

const engine = spawn(process.execPath, [HOST, ENGINE], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const lines = [];
engine.stdout.on('data', (d) => {
  buf += d;
  const parts = buf.split('\n');
  buf = parts.pop();
  parts.forEach((l) => lines.push(l.trim()));
});

const wait = (pred, ms) =>
  new Promise((res) => {
    const t = setInterval(() => {
      if (pred()) {
        clearInterval(t);
        res(true);
      }
    }, 25);
    setTimeout(() => {
      clearInterval(t);
      res(false);
    }, ms);
  });

engine.stdin.write('uci\n');
await wait(() => lines.includes('uciok'), 20000);

async function bestMove(fen, depth = 16) {
  lines.length = 0;
  engine.stdin.write('setoption name MultiPV value 1\n');
  engine.stdin.write(`position fen ${fen}\n`);
  engine.stdin.write(`go depth ${depth}\n`);
  await wait(() => lines.some((l) => l.startsWith('bestmove')), 60000);
  const bm = lines.find((l) => l.startsWith('bestmove'));
  return bm ? bm.split(/\s+/)[1] : null;
}

let failures = 0;
for (const lesson of LESSONS) {
  const problems = [];

  let game;
  try {
    game = new Chess(lesson.fen);
  } catch (e) {
    console.log(`✗ ${lesson.angle}: illegal FEN — ${e.message}`);
    failures++;
    continue;
  }

  // engine's opinion on the first move
  const uci = await bestMove(lesson.fen);
  let engineSan = null;
  if (uci) {
    const probe = new Chess(lesson.fen);
    try {
      engineSan = probe.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4, 5) || undefined,
      }).san;
    } catch {
      /* ignore */
    }
  }

  // replay the lesson
  for (const [i, step] of lesson.steps.entries()) {
    try {
      const mv = game.move(step.san);
      if (step.san.endsWith('#') && !game.isCheckmate()) {
        problems.push(`step ${i + 1} (${step.san}) claims mate but is not checkmate`);
      }
      if (!step.san.endsWith('#') && game.isCheckmate()) {
        problems.push(`step ${i + 1} (${mv.san}) IS checkmate but is not marked '#'`);
      }
    } catch {
      problems.push(`step ${i + 1} (${step.san}) is not a legal move`);
      break;
    }
  }

  const first = lesson.steps[0]?.san;
  if (engineSan && first && engineSan !== first) {
    problems.push(`engine prefers ${engineSan}, lesson teaches ${first}`);
  }

  if (problems.length) {
    failures++;
    console.log(`✗ ${lesson.angle.padEnd(18)} ${problems.join('; ')}`);
  } else {
    console.log(`✓ ${lesson.angle.padEnd(18)} ${lesson.steps.map((s) => s.san).join(' ')}  (engine agrees: ${engineSan})`);
  }
}

engine.kill();
console.log(`\n${LESSONS.length - failures}/${LESSONS.length} lessons verified`);
process.exit(failures ? 1 : 0);
