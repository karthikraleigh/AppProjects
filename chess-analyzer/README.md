# Chess Analyzer

An offline chess analysis desktop app: Stockfish 18, move grading, a 3,790-line
opening explorer, full-game review with commentary, and imports from chess.com
and Lichess.

## Running

```bash
npm install          # also copies the engine into resources/engine
npm run dev          # dev with HMR
npm run build        # bundle main + preload + renderer
npm run build:win    # NSIS installer -> dist/
npm run typecheck
```

`build:win` runs `engine:full` first, so **both engine builds ship in the
installer**: the 7 MB lite net (default) and the 108 MB full net, selectable in
Settings. That is most of the installer's size. To build without the full net,
delete `resources/engine/stockfish-18-single.*` and run `electron-builder --win`
directly.

For a dev run, `npm install` copies only the lite net. Add the full one with:

```bash
npm run engine:full
```

## Features

- **Click or drag to move.** Click a piece to see its legal moves (dots for quiet
  moves, rings for captures), then click a destination. Dragging still works.
  Promotions prompt for a piece.
- **Live analysis.** Every move is analysed as you play; the engine's best move
  is drawn on the board and the top lines listed. Sub-second at depth 18.
- **Move grading.** Book / Brilliant / Great / Best / Excellent / Good /
  Inaccuracy / Mistake / Miss / Blunder, from win-probability loss rather than
  raw centipawns.
- **Commentary.** Templated from real engine output — eval swing, the better
  move, the refutation line, hanging pieces, forks. Deterministic and offline.
- **Opening explorer.** 3,790 ECO lines bundled. Book continuations are ranked
  by how many named lines pass through them, so mainlines come first. Shows the
  opening name, and where the game left theory.
- **Trap warnings.** 14 named trap lines (Noah's Ark, Lasker, Mortimer,
  Tarrasch, ...). Continuations that walk into one are flagged ⚠, and the panel
  warns when a trap is within four plies.
- **Game review.** Import from chess.com, Lichess, or PGN. Two-pass analysis
  with a progress bar; results cached to disk so reopening is instant.
- **Saved games.** Imported games persist to `userData/library.json` and are
  reloadable offline. Reviews are cached (most recent 50).
- **Eval graph.** White win probability across the game, click to seek.
- **Learn mode.** Eight tactics lessons (fork, pin, skewer, discovered attack,
  back-rank mate, smothered mate, hanging piece, promotion). Each has an
  explanation, a cue for what to look for, and a worked example you step
  through. Every example is engine-verified — see `npm run verify:lessons`.
- **Puzzle mode.** Twenty themes, three difficulty bands, hints, solutions, and
  an Elo-style puzzle rating with streaks. Puzzles are imported from Lichess
  once a day and then work entirely offline.

## Architecture

```
Electron main ──spawn──> engine-host.cjs (bare Node)
     │                        └─ Stockfish WASM, UCI over stdin/stdout
     ├── IPC (contextBridge, contextIsolation)
     └── net.fetch proxy, host-allowlisted
Renderer (React 19 + TS)
     engine/ analysis/ openings/ import/ ui/
```

## Things that are true and cost time to discover

These are load-bearing. Changing them will break the app in non-obvious ways.

- **The multithreaded WASM builds do not work under Node.** `stockfish-18-lite.js`
  initialises and answers `uci`/`uciok`, but exposes no `Threads` or `MultiPV`
  option, rejects both (`No such option: Threads`), and never returns a
  `bestmove`. Its pthread pool needs a cross-origin-isolated browser. The app
  therefore runs **single-threaded**, and `Threads` is not exposed in Settings.
  The strength upgrade is a bigger net, not more threads.

- **Engine output cannot be captured in-process.** The `stockfish` npm wrapper
  exposes `sendCommand` but never wires a listener, and setting `Module.print`
  (before *or* after init) silently misses output — it goes to the real stdout.
  Hence `engine-host.cjs`: run the engine as a child process, read stdout.

- **The engine must be unpacked from the asar archive.** Emscripten's
  `locateFile()` needs a real filesystem path for the `.wasm`. It lives in
  `extraResources`.

- **`explorer.lichess.ovh` returns HTTP 401**, even with a browser User-Agent.
  The opening explorer cannot depend on it, so the ECO TSVs are bundled.

- **"In book" is the set of positions ECO lines *traverse*, not the set of
  positions where a line *ends*.** Only ~3,790 positions terminate a named row,
  but many mainline positions sit mid-row: testing against the terminal set
  calls `4.Ba4` in the Ruy Lopez "out of book" and hides `6...Nxd4` from the
  explorer entirely. `isBookPosition` and `continuations` use the traversal set.

- **Out-of-book is judged from the current position**, not from whether the game
  ever strayed. An offbeat move order can leave theory and transpose straight
  back in; blaming the earlier move is wrong.

- **Review must analyse both endpoints of every non-book ply.** Skipping all
  book positions drops the eval *before* the first out-of-book move, and that
  move then gets graded against a phantom 0.00.

- **Partial stdout lines.** UCI lines arrive split mid-token. Both the host and
  the parent keep a remainder buffer. Removing it corrupts `info` lines silently.

- **`playSan` validates.** An illegal SAN appended to history silently truncates
  the FEN replay and kills grading for every later ply, with no error.

- **A deliberate engine swap and an engine crash are different events.** A
  replaced child's `exit` arrives *after* its replacement is already running, so
  reporting it as a crash tears down the **new** engine's in-flight search --
  the next position silently never gets analysed. `EngineProcess` marks retired
  children and stays silent for them; main sends `engine:reset` before the swap,
  and `engine:exit` means an actual crash. Both settle the queue, or it
  deadlocks permanently.

- **Readiness is polled, not awaited.** A restart can clear `ready` *after* the
  new engine already answered `readyok`. Waiting passively for a `readyok` that
  already happened hangs forever; `isready` is re-sent until it answers.

- **Game ids must be stable.** chess.com's `Site` is the literal string
  `"Chess.com"` -- the id is in `Link`. Lichess puts it in `Site`. A
  timestamp+counter id makes re-importing the same game duplicate it in the
  library, so anything else falls back to hashing the PGN.

- **`/api/puzzle/next` is unusable for bulk.** Measured: 429 after ~6 rapid
  calls, still 429 after 75 seconds fully idle, and the throttle body is HTML
  rather than JSON. An unknown `angle` is silently ignored, not rejected. Other
  Lichess endpoints (`/api/puzzle/daily`, `/api/puzzle/{id}`, games) are fine.
  Puzzles therefore come from the **database dump**, in one bounded slice a day.

- **The puzzle dump starts with a 12-byte zstd *skippable* frame.** Decompressing
  from byte 0 silently yields zero bytes with no error. The real data frame
  begins at byte 12; a second frame begins at 227,041,731. A ~5.7 MB slice
  decodes to ~119k rows, which is plenty to sample from. `windowLogMax` must be
  raised, and a truncated frame ends in an error — that is how the download stays
  bounded, not a failure.

- **Dump `Moves[0]` is the *opponent's* move**, and the dump's FEN is the
  position before it. The solver starts one ply later. The API's shape differs:
  there the PGN already ends at the puzzle position and `solution[0]` is the
  solver's move. Verified: 400/400 rows legal, 133/133 `mateInN` end in mate.

- **Solutions have odd length**, so the solver moves both first and last. An
  even-length solution means the ply offset is wrong.

- **A `Range` request must be answered with 206.** A plain `200` means the server
  ignored the header and is about to hand over the whole 288 MB dump, which
  `arrayBuffer()` will cheerfully buffer. Treating `res.ok` as success is a trap.

- **Never auto-queen.** Underpromotion is occasionally the only winning move
  (puzzle `18eLE` requires `h2h1n`), so a board that silently promotes to a queen
  makes those positions unsolvable. `PlayableBoard` prompts for the piece.

## Measured (this machine, depth 18, MultiPV 3, middlegame)

| Build | Size | Time/position | nps |
|---|---|---|---|
| `lite-single` (default) | 7 MB | ~1.5 s | ~950k |
| `single` (full net) | 108 MB | ~2.2 s | ~430k |
| `lite` (multithreaded) | 7 MB | never finishes | — |

A full 89-ply game review takes ~72 s cold and 0 ms from cache. Live per-move
analysis is sub-second; a whole-game review is not, and shows a progress bar.

## Grading

Chess.com's algorithm is proprietary. This is a documented heuristic over engine
output: win-probability loss `Δwp` versus the engine's best move, plus MultiPV
context. Thresholds live in `src/renderer/src/analysis/constants.ts`.

`MultiPV >= 2` is required to detect Great (only-move) and Brilliant (sound
sacrifice) — with 1 line they can never fire.

## Verification harness

The app can drive and screenshot itself, no GUI interaction needed:

```bash
CHESS_SHOT=out.png CHESS_SHOT_MOVES="e4,e5,Nf3" npx electron .
CHESS_SHOT=out.png CHESS_SHOT_SCRIPT=test.js npx electron .   # arbitrary renderer script
CHESS_SHOT_OFFLINE=1 ...                                      # dead proxy + navigator.onLine=false
```

Works against the packaged `.exe` too, which is how the asar/`locateFile` path
gets exercised.

Two non-obvious details:

- `capturePage()` is used rather than an OS screen grab, because Windows'
  `PrintWindow()` returns a blank bitmap for GPU-composited Chromium windows.
- The hook is signalled by a `?testhook=1` **query parameter on the renderer
  URL**. Neither `process.env` nor `webPreferences.additionalArguments` reaches
  the preload reliably in a packaged build; the page's own `location` does.
