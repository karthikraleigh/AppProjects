/* eslint-disable */
// Stockfish host. Spawned as a plain Node process (ELECTRON_RUN_AS_NODE=1).
//
// Reads UCI commands on stdin, one per line. The engine writes its own replies
// straight to stdout, so the parent just reads our stdout.
//
// Do NOT try to capture engine output via Module.print. Assigning it before or
// after init silently misses everything -- output bypasses it and goes to the
// real stdout. Driving the engine as a child process and reading stdout is both
// the thing that works and how UCI engines are normally driven.
//
// argv[2] = absolute path to the engine base name, without extension.
//           e.g. .../resources/engine/stockfish-18-lite-single

const enginePath = process.argv[2];

if (!enginePath) {
  console.error('engine-host: missing engine path argument');
  process.exit(2);
}

const factory = require(enginePath + '.js');

factory()({
  // Emscripten asks for the .wasm by bare filename; point it at the real file.
  // This is why the engine must be unpacked from the asar archive.
  locateFile: (f) => (f.endsWith('.wasm') ? enginePath + '.wasm' : f),
})
  .then((mod) => {
    const send = (cmd) =>
      mod.ccall('command', null, ['string'], [cmd], { async: /^go\b/.test(cmd) });

    // stdin arrives in arbitrary chunks; a command can be split mid-token.
    let buf = '';
    process.stdin.on('data', (chunk) => {
      buf += chunk;
      const parts = buf.split('\n');
      buf = parts.pop(); // keep the partial trailing line
      for (const line of parts) {
        const cmd = line.trim();
        if (cmd) send(cmd);
      }
    });

    process.stdin.on('end', () => {
      try {
        send('quit');
      } catch {}
      process.exit(0);
    });

    process.stdin.resume();
    console.error('engine-host: ready');
  })
  .catch((err) => {
    console.error('engine-host: init failed:', err && err.message);
    process.exit(1);
  });
