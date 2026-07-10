import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Puzzle } from '@shared/types';

export type PuzzleStatus = 'solving' | 'wrong' | 'solved' | 'revealed';

const REPLY_DELAY_MS = 420;

function uciOf(move: { from: string; to: string; promotion?: string }): string {
  return move.from + move.to + (move.promotion ?? '');
}

/**
 * Drives one puzzle.
 *
 * The solver always moves first and last (solutions have odd length). Correct
 * moves are answered automatically by the opponent's recorded reply.
 *
 * An alternative move that delivers immediate checkmate is accepted too: a mate
 * is a mate, and rejecting it would be indefensible to the solver.
 */
export function usePuzzle(puzzle: Puzzle | null): {
  fen: string;
  status: PuzzleStatus;
  solverColor: 'w' | 'b';
  /** Index into `solution` of the move the solver must find next. */
  index: number;
  clean: boolean;
  hintSquare: string | null;
  lastWrong: string | null;
  tryMove: (from: string, to: string, promotion: string) => boolean;
  hint: () => void;
  reveal: () => void;
  reset: () => void;
} {
  const [fen, setFen] = useState(puzzle?.fen ?? new Chess().fen());
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<PuzzleStatus>('solving');
  const [clean, setClean] = useState(true);
  const [hintSquare, setHintSquare] = useState<string | null>(null);
  const [lastWrong, setLastWrong] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const solverColor = (puzzle ? puzzle.fen.split(' ')[1] : 'w') as 'w' | 'b';

  const clearTimer = (): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const reset = useCallback(() => {
    clearTimer();
    setFen(puzzle?.fen ?? new Chess().fen());
    setIndex(0);
    setStatus('solving');
    setClean(true);
    setHintSquare(null);
    setLastWrong(null);
  }, [puzzle]);

  useEffect(() => reset(), [reset]);
  useEffect(() => clearTimer, []);

  const tryMove = useCallback(
    (from: string, to: string, promotion: string): boolean => {
      if (!puzzle || status === 'solved' || status === 'revealed') return false;

      const game = new Chess(fen);
      let move;
      try {
        move = game.move({ from, to, promotion });
      } catch {
        return false; // not a legal chess move: board snaps back, no penalty
      }

      const expected = puzzle.solution[index];
      const played = uciOf(move);
      const isMate = game.isCheckmate();

      if (played !== expected && !isMate) {
        // Legal but not the solution. Don't apply it.
        setStatus('wrong');
        setClean(false);
        setLastWrong(move.san);
        return false;
      }

      setLastWrong(null);
      setHintSquare(null);
      setFen(game.fen());

      const nextIndex = index + 1;
      if (isMate || nextIndex >= puzzle.solution.length) {
        setIndex(puzzle.solution.length);
        setStatus('solved');
        return true;
      }

      // Play the opponent's recorded reply.
      setStatus('solving');
      setIndex(nextIndex);
      clearTimer();
      timer.current = window.setTimeout(() => {
        const reply = puzzle.solution[nextIndex];
        const board = new Chess(game.fen());
        try {
          board.move({
            from: reply.slice(0, 2),
            to: reply.slice(2, 4),
            promotion: reply.slice(4, 5) || undefined,
          });
        } catch {
          return;
        }
        setFen(board.fen());
        setIndex(nextIndex + 1);
      }, REPLY_DELAY_MS);

      return true;
    },
    [puzzle, fen, index, status],
  );

  const hint = useCallback(() => {
    if (!puzzle || status === 'solved' || status === 'revealed') return;
    setClean(false);
    setHintSquare(puzzle.solution[index]?.slice(0, 2) ?? null);
  }, [puzzle, index, status]);

  const reveal = useCallback(() => {
    if (!puzzle) return;
    clearTimer();
    setClean(false);
    const game = new Chess(puzzle.fen);
    for (const uci of puzzle.solution) {
      try {
        game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });
      } catch {
        break;
      }
    }
    setFen(game.fen());
    setIndex(puzzle.solution.length);
    setStatus('revealed');
  }, [puzzle]);

  return { fen, status, solverColor, index, clean, hintSquare, lastWrong, tryMove, hint, reveal, reset };
}
