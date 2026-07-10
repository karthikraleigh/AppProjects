// Copies the Stockfish WASM builds we ship out of node_modules into resources/engine.
//
// Only `lite-single` is copied by default. The full-net build is 108 MB and is an
// opt-in (`npm run engine:full`) so the default installer stays small.
//
// The multithreaded builds (stockfish-18-lite.js / stockfish-18.js) are deliberately
// NOT copied: under Node they expose no Threads/MultiPV options and never return a
// bestmove. See the plan for the measurements.

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'node_modules', 'stockfish', 'bin');
const outDir = join(root, 'resources', 'engine');

const wantFull = process.argv.includes('--full');
const builds = ['stockfish-18-lite-single', ...(wantFull ? ['stockfish-18-single'] : [])];

if (!existsSync(srcDir)) {
  console.error(`[copy-engine] ${srcDir} not found — run npm install first.`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

let copied = 0;
for (const base of builds) {
  for (const ext of ['.js', '.wasm']) {
    const from = join(srcDir, base + ext);
    const to = join(outDir, base + ext);
    if (!existsSync(from)) {
      console.error(`[copy-engine] missing ${from}`);
      process.exit(1);
    }
    // Skip if already present at the same size; these files are large.
    if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
    copyFileSync(from, to);
    copied++;
    console.log(`[copy-engine] ${base + ext} (${(statSync(to).size / 1048576).toFixed(1)} MB)`);
  }
}

console.log(`[copy-engine] ${copied ? `copied ${copied} file(s)` : 'up to date'} -> resources/engine`);
if (!wantFull) console.log('[copy-engine] full 108 MB net not included; run `npm run engine:full` to add it.');
