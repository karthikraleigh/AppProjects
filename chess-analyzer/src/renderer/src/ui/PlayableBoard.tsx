import { useCallback, useEffect, useMemo, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';

export interface Arrow {
  startSquare: string;
  endSquare: string;
  color: string;
}

interface Props {
  fen: string;
  /** Attempt a move. Return false to reject it (the board snaps back). */
  onMove?: (from: string, to: string, promotion: string) => boolean;
  orientation?: 'white' | 'black';
  arrows?: Arrow[];
  /** Extra square styling merged under the selection hints. */
  highlights?: Record<string, React.CSSProperties>;
  interactive?: boolean;
}

const SELECT_BG = 'rgba(232, 163, 61, 0.45)';
const CAPTURE_BG = 'radial-gradient(circle, transparent 54%, rgba(232, 163, 61, 0.5) 55%)';
const QUIET_BG = 'radial-gradient(circle, rgba(232, 163, 61, 0.5) 21%, transparent 22%)';

const PROMOTION_PIECES = [
  { piece: 'q', label: 'Queen', glyph: '♛' },
  { piece: 'r', label: 'Rook', glyph: '♜' },
  { piece: 'b', label: 'Bishop', glyph: '♝' },
  { piece: 'n', label: 'Knight', glyph: '♞' },
];

/**
 * A board you can play on by clicking or dragging.
 *
 * Owns only the selection; the position lives with the caller. Shared by the
 * analysis board, puzzle mode and the lesson stepper.
 *
 * Promotions prompt for a piece rather than auto-queening: underpromotion is
 * rare but it is sometimes the *only* winning move, and silently queening makes
 * those positions impossible to play.
 */
export function PlayableBoard({
  fen,
  onMove,
  orientation = 'white',
  arrows = [],
  highlights,
  interactive = true,
}: Props): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);

  // Any position change drops the selection and any pending promotion.
  useEffect(() => {
    setSelected(null);
    setPromotion(null);
  }, [fen]);

  /** Legal destinations from the selected square; value = is a capture. */
  const legalTargets = useMemo(() => {
    const targets = new Map<string, boolean>();
    if (!selected || !interactive) return targets;
    try {
      const game = new Chess(fen);
      for (const mv of game.moves({ square: selected as Square, verbose: true })) {
        targets.set(mv.to, Boolean(mv.captured));
      }
    } catch {
      /* selection can be stale for one render */
    }
    return targets;
  }, [fen, selected, interactive]);

  /** Would moving from->to be a pawn promotion? */
  const isPromotion = useCallback(
    (from: string, to: string): boolean => {
      try {
        const game = new Chess(fen);
        return game
          .moves({ square: from as Square, verbose: true })
          .some((m) => m.to === to && m.flags.includes('p'));
      } catch {
        return false;
      }
    },
    [fen],
  );

  const attempt = useCallback(
    (from: string, to: string): boolean => {
      if (!onMove) return false;
      if (isPromotion(from, to)) {
        // Ask which piece. The board snaps back until the choice is made.
        setPromotion({ from, to });
        return false;
      }
      return onMove(from, to, 'q');
    },
    [onMove, isPromotion],
  );

  const choosePromotion = useCallback(
    (piece: string) => {
      if (!promotion) return;
      const { from, to } = promotion;
      setPromotion(null);
      setSelected(null);
      onMove?.(from, to, piece);
    },
    [promotion, onMove],
  );

  const onSquareClick = useCallback(
    ({ square }: { square: string }): void => {
      if (!interactive || promotion) return;
      if (selected && legalTargets.has(square)) {
        attempt(selected, square);
        setSelected(null);
        return;
      }
      let piece;
      try {
        const game = new Chess(fen);
        piece = game.get(square as Square);
        setSelected(piece && piece.color === game.turn() ? square : null);
      } catch {
        setSelected(null);
      }
    },
    [fen, selected, legalTargets, attempt, interactive, promotion],
  );

  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }): boolean => {
      setSelected(null);
      if (!interactive || !targetSquare) return false;
      return attempt(sourceSquare, targetSquare);
    },
    [attempt, interactive],
  );

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = { ...highlights };
    if (selected) styles[selected] = { ...styles[selected], background: SELECT_BG };
    for (const [square, isCapture] of legalTargets) {
      styles[square] = { ...styles[square], background: isCapture ? CAPTURE_BG : QUIET_BG };
    }
    return styles;
  }, [selected, legalTargets, highlights]);

  const promotingColor = promotion ? (fen.split(' ')[1] === 'w' ? 'white' : 'black') : null;

  return (
    <div className="playable-board">
      <Chessboard
        options={{
          position: fen,
          onPieceDrop,
          onSquareClick,
          squareStyles,
          arrows,
          boardOrientation: orientation,
          allowDragging: interactive && !promotion,
          animationDurationInMs: 150,
          darkSquareStyle: { backgroundColor: '#7c6f56' },
          lightSquareStyle: { backgroundColor: '#dcd3b8' },
        }}
      />

      {promotion && (
        <div className="promotion-overlay" onClick={() => setPromotion(null)}>
          <div className="promotion-picker" onClick={(e) => e.stopPropagation()}>
            <span className="promotion-title">Promote to</span>
            <div className="promotion-choices">
              {PROMOTION_PIECES.map(({ piece, label, glyph }) => (
                <button
                  key={piece}
                  className={`promotion-choice ${promotingColor}`}
                  title={label}
                  onClick={() => choosePromotion(piece)}
                >
                  {glyph}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
