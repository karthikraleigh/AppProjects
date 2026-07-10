/**
 * The tactics curriculum.
 *
 * `angle` is the Lichess puzzle theme key, verified against the `Themes` column
 * of the puzzle dump -- so it doubles as the filter for practice puzzles.
 *
 * Every worked example is checked by `scripts/verify-lessons.mjs`: the position
 * must be legal, the solution must be legal, mating lines must actually mate,
 * and the first move must be Stockfish's best move. A lesson that teaches a
 * move the engine disagrees with is worse than no lesson.
 */

export interface LessonStep {
  /** SAN, played from the position reached so far. */
  san: string;
  note: string;
}

export interface Lesson {
  /** Lichess theme key. Also the practice filter. */
  angle: string;
  title: string;
  /** One-paragraph explanation of the motif. */
  explanation: string;
  /** What to look for over the board. */
  cue: string;
  /** Starting position of the worked example. */
  fen: string;
  /** The line, played out one ply at a time. */
  steps: LessonStep[];
}

export const LESSONS: Lesson[] = [
  {
    angle: 'fork',
    title: 'Fork',
    explanation:
      'A fork is one piece attacking two targets at once. The opponent can only answer one of them, so the other falls. Knights are the classic forking piece: no piece can block a knight, so once both targets are hit, both stay hit. A fork that also gives check is strongest — the opponent has no time to counter-attack.',
    cue: 'Look for undefended pieces and the king standing a knight-move apart.',
    fen: '2q1k3/8/8/4PN2/8/8/8/4K3 w - - 0 1',
    steps: [
      {
        san: 'Nd6+',
        note: 'The knight lands on d6 attacking the king on e8 and the queen on c8 at the same time. It is defended by the e5 pawn, so it cannot simply be taken.',
      },
      { san: 'Ke7', note: 'The check must be answered. The queen is left hanging.' },
      { san: 'Nxc8+', note: 'And the knight collects the queen.' },
    ],
  },
  {
    angle: 'pin',
    title: 'Pin',
    explanation:
      'A pin freezes a piece: it cannot move because something more valuable sits behind it. When the king is behind, the pinned piece is absolutely paralysed — moving it would be illegal. A pinned piece is a poor defender, so the usual follow-up is to attack it again and win it.',
    cue: 'Line up a bishop, rook, or queen against a piece with the king behind it.',
    fen: '3k4/3n4/8/8/8/8/8/3RKB2 w - - 0 1',
    steps: [
      {
        san: 'Bb5',
        note: 'The rook on d1 already pins the knight to the king — the knight cannot legally move. Bb5 attacks it a second time. A pinned piece cannot run.',
      },
      { san: 'Kc7', note: 'Black steps aside, but the knight is attacked twice and defended once.' },
      { san: 'Bxd7', note: 'The knight falls.' },
    ],
  },
  {
    angle: 'skewer',
    title: 'Skewer',
    explanation:
      'A skewer is a pin turned inside out. The valuable piece is in front; when it moves out of the attack, the lesser piece behind it is captured. Against a king the skewer is forcing — the king must move, so the piece behind it is simply lost.',
    cue: 'A king and a queen or rook on the same line, king in front.',
    fen: '3q4/8/8/3k4/8/8/8/R3K3 w - - 0 1',
    steps: [
      {
        san: 'Rd1+',
        note: 'The rook checks along the d-file. The king is in front, the queen behind it.',
      },
      { san: 'Kc5', note: 'The king must leave the file. Nothing can block.' },
      { san: 'Rxd8', note: 'The queen was behind the king, so it drops.' },
    ],
  },
  {
    angle: 'discoveredAttack',
    title: 'Discovered attack',
    explanation:
      'One piece steps aside and uncovers an attack from the piece behind it. Because the moving piece can create a threat of its own, a discovered attack makes two threats with one move. The opponent cannot parry both.',
    cue: 'Your own piece standing between your long-range piece and a target.',
    fen: '3q2k1/5ppp/8/8/3N4/8/5PPP/3RK3 w - - 0 1',
    steps: [
      {
        san: 'Nc6',
        note: 'The knight steps off the d-file, uncovering the rook on d1 against the queen on d8 — and attacks that same queen from c6. Two attackers, no defenders, and the knight itself is out of reach.',
      },
      { san: 'Qxd1+', note: 'Giving the queen for the rook is the best of a bad lot.' },
      { san: 'Kxd1', note: 'White has won a queen for a rook.' },
    ],
  },
  {
    angle: 'backRankMate',
    title: 'Back-rank mate',
    explanation:
      'A castled king shelters behind its own pawns — and those pawns are also its prison. A rook or queen arriving on the back rank delivers mate because the king has no square to step to. Every player who has ever castled has lost a game to this.',
    cue: 'An enemy king on the back rank with unmoved pawns in front of it.',
    fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
    steps: [
      {
        san: 'Ra8#',
        note: 'Checkmate. The king cannot take the rook, cannot block, and f7/g7/h7 are blocked by its own pawns. Giving the king an escape square — "luft" — is the standard prophylaxis.',
      },
    ],
  },
  {
    angle: 'smotheredMate',
    title: 'Smothered mate',
    explanation:
      'The most beautiful mate in chess. The king is hemmed in entirely by its own pieces, and a knight — the one piece that jumps — delivers mate from a square nothing can reach. It usually arrives at the end of a queen sacrifice that forces the king into the corner.',
    cue: 'An enemy king in the corner, surrounded by its own men, and a knight nearby.',
    fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1',
    steps: [
      {
        san: 'Nf7#',
        note: 'Checkmate. The knight checks from f7. The king cannot capture it, nothing else can reach f7, and g8, g7 and h7 are all occupied by Black\'s own pieces.',
      },
    ],
  },
  {
    angle: 'hangingPiece',
    title: 'Hanging piece',
    explanation:
      'The least glamorous tactic and by far the most common. A piece is "hanging" when it is attacked and nobody defends it. Most games below master level are decided by one side simply leaving something en prise. Before every move, look at what your opponent attacks — and at what you have left undefended.',
    cue: 'Every check, capture, and undefended piece — yours and theirs.',
    fen: 'r1bqkbnr/pppp1ppp/8/4n3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1',
    steps: [
      {
        san: 'Nxe5',
        note: 'The knight on e5 is attacked by the knight on f3 and defended by nothing. White simply takes it. There is no combination here — just counting attackers and defenders.',
      },
    ],
  },
  {
    angle: 'promotion',
    title: 'Promotion',
    explanation:
      'A pawn reaching the eighth rank becomes any piece you choose — almost always a queen. In the endgame every pawn is a queen in waiting, which is why a single passed pawn can outweigh a piece. Occasionally a knight, or even a rook, is stronger: promoting to a queen can stalemate.',
    cue: 'Passed pawns. Push them.',
    fen: '8/P7/8/8/8/1k6/8/K7 w - - 0 1',
    steps: [
      {
        san: 'a8=Q',
        note: 'The pawn becomes a queen. A rook or knight would be worse, and here a queen is entirely safe.',
      },
    ],
  },
];

/** Practice themes that have no lesson of their own but appear in puzzle mode. */
export const EXTRA_THEMES: Array<{ angle: string; title: string }> = [
  { angle: 'mateIn1', title: 'Mate in 1' },
  { angle: 'mateIn2', title: 'Mate in 2' },
  { angle: 'mateIn3', title: 'Mate in 3' },
  { angle: 'deflection', title: 'Deflection' },
  { angle: 'attraction', title: 'Attraction' },
  { angle: 'sacrifice', title: 'Sacrifice' },
  { angle: 'doubleCheck', title: 'Double check' },
  { angle: 'trappedPiece', title: 'Trapped piece' },
  { angle: 'zugzwang', title: 'Zugzwang' },
  { angle: 'advancedPawn', title: 'Advanced pawn' },
  { angle: 'defensiveMove', title: 'Defensive move' },
  { angle: 'xRayAttack', title: 'X-ray attack' },
];

/** Every theme the app imports puzzles for. */
export const ALL_THEMES: string[] = [
  ...LESSONS.map((l) => l.angle),
  ...EXTRA_THEMES.map((t) => t.angle),
];

/**
 * Display name for a theme. Lichess tags puzzles with many themes beyond the
 * curriculum (`exposedKing`, `queenRookEndgame`, ...), so unknown camelCase
 * keys are humanised rather than shown raw.
 */
export function themeTitle(angle: string): string {
  const known =
    LESSONS.find((l) => l.angle === angle)?.title ??
    EXTRA_THEMES.find((t) => t.angle === angle)?.title;
  if (known) return known;

  const spaced = angle
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // exposedKing -> exposed King
    .replace(/([a-zA-Z])(\d)/g, '$1 $2') // mateIn5      -> mate In 5
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
