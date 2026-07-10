import { useEffect, useRef, useState } from 'react';
import type { PositionEval } from '@shared/types';
import { getEngine } from './client';

/**
 * Live analysis of a position. Streams partial results as the engine deepens,
 * which is what makes it feel instant, and discards results that arrive for a
 * position the user has already left.
 *
 * `onEval` receives every evaluation produced for the position it was requested
 * for -- including partial ones, and including searches the user superseded by
 * moving on. Without that, moving before a search finishes throws its result
 * away and the move can never be graded.
 */
export function useAnalysis(
  fen: string,
  depth: number,
  multipv: number,
  onEval?: (evaluation: PositionEval) => void,
): { evaluation: PositionEval | null; thinking: boolean } {
  const [evaluation, setEvaluation] = useState<PositionEval | null>(null);
  const [thinking, setThinking] = useState(false);
  const fenRef = useRef(fen);
  const onEvalRef = useRef(onEval);
  onEvalRef.current = onEval;

  useEffect(() => {
    fenRef.current = fen;
    setEvaluation(null);
    setThinking(true);

    const engine = getEngine();
    let stale = false;

    void engine
      .analyze(fen, {
        depth,
        multipv,
        onUpdate: (partial) => {
          if (partial.fen === fen && partial.lines.length) onEvalRef.current?.(partial);
          if (!stale && partial.fen === fenRef.current) setEvaluation(partial);
        },
      })
      .then((final) => {
        if (final.fen === fen && final.lines.length) onEvalRef.current?.(final);
        if (!stale && final.fen === fenRef.current) {
          setEvaluation(final);
          setThinking(false);
        }
      });

    return () => {
      stale = true;
    };
  }, [fen, depth, multipv]);

  return { evaluation, thinking };
}
