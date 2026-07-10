import { useEffect, useState } from 'react';
import type { EngineBuild, EngineOptions } from '@shared/types';

interface EngineStatus {
  running: boolean;
  build: EngineBuild;
  packaged: boolean;
  available: Record<EngineBuild, boolean>;
}

interface Props {
  options: EngineOptions;
  onChange: (next: EngineOptions) => void;
}

export function Settings({ options, onChange }: Props): React.JSX.Element {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.api.engine.status().then(setStatus);
  }, [options.build]);

  const set = <K extends keyof EngineOptions>(key: K, value: EngineOptions[K]): void => {
    onChange({ ...options, [key]: value });
  };

  const switchBuild = async (build: EngineBuild): Promise<void> => {
    setError(null);
    try {
      await window.api.engine.restart(build);
      set('build', build);
      setStatus(await window.api.engine.status());
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+':\s*/, ''));
    }
  };

  return (
    <div className="panel settings-panel">
      <div className="panel-head">
        <h3>Settings</h3>
        <span className="muted">{status?.running ? `engine: ${status.build}` : 'engine stopped'}</span>
      </div>

      <label className="field">
        <span>Engine build</span>
        <select value={options.build} onChange={(e) => void switchBuild(e.target.value as EngineBuild)}>
          <option value="lite-single">Lite net (7 MB) — faster, recommended</option>
          <option value="single" disabled={!status?.available.single}>
            Full net (108 MB) — stronger, slower
            {status && !status.available.single ? ' — not installed' : ''}
          </option>
        </select>
      </label>

      {status?.available.single ? (
        <p className="muted small">
          The full net evaluates better but searches fewer positions per second (~430k vs ~950k), so
          each position takes about 1.4× longer. Game reviews are cached per engine build, so
          switching re-runs them once. Stockfish recommends the lite net for most uses.
        </p>
      ) : (
        <p className="muted small">
          {status?.packaged ? (
            <>
              The full-strength net is missing. Put <code>stockfish-18-single.js</code> and{' '}
              <code>.wasm</code> in the app’s <code>resources/engine</code> folder.
            </>
          ) : (
            <>
              Run <code>npm run engine:full</code> to install the full-strength net.
            </>
          )}
        </p>
      )}
      {error && <p className="error small">{error}</p>}

      <label className="field">
        <span>Live analysis depth: {options.liveDepth}</span>
        <input
          type="range"
          min={8}
          max={26}
          value={options.liveDepth}
          onChange={(e) => set('liveDepth', Number(e.target.value))}
        />
      </label>

      <label className="field">
        <span>Review depth (deep pass): {options.reviewDepth}</span>
        <input
          type="range"
          min={10}
          max={24}
          value={options.reviewDepth}
          onChange={(e) => set('reviewDepth', Number(e.target.value))}
        />
      </label>

      <label className="field">
        <span>Review depth (fast pass): {options.reviewShallowDepth}</span>
        <input
          type="range"
          min={6}
          max={18}
          value={options.reviewShallowDepth}
          onChange={(e) => set('reviewShallowDepth', Number(e.target.value))}
        />
      </label>

      <label className="field">
        <span>Engine lines (MultiPV): {options.multipv}</span>
        <input
          type="range"
          min={1}
          max={5}
          value={options.multipv}
          onChange={(e) => set('multipv', Number(e.target.value))}
        />
        <span className="muted small">2 or more is required to detect “Great” and “Brilliant” moves.</span>
      </label>

      <label className="field">
        <span>Hash table: {options.hashMb} MB</span>
        <input
          type="range"
          min={16}
          max={1024}
          step={16}
          value={options.hashMb}
          onChange={(e) => set('hashMb', Number(e.target.value))}
        />
      </label>

      <p className="muted small">
        Threads are not exposed: the multithreaded WebAssembly build does not function outside a
        cross-origin-isolated browser, so this app runs Stockfish single-threaded.
      </p>
    </div>
  );
}
