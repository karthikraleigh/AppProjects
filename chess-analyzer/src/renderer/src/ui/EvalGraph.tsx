import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { GradedMove } from '@shared/types';
import { GRADE_META } from '@/analysis/constants';
import { formatEval, winProb } from '@/analysis/winprob';

interface Props {
  moves: GradedMove[];
  currentPly: number;
  onSeek: (ply: number) => void;
}

/**
 * How the game swung. Plotted as White's win probability rather than raw
 * centipawns, so a +9 -> +12 swing doesn't dwarf the +0.2 -> -1.5 that actually
 * decided the game.
 */
export function EvalGraph({ moves, currentPly, onSeek }: Props): React.JSX.Element {
  const data = moves.map((m) => ({
    ply: m.ply,
    /** -50..+50, centred on 0 for an even position. */
    advantage: winProb(m.evalAfterCp) * 100 - 50,
    evalCp: m.evalAfterCp,
    san: m.san,
    grade: m.grade,
  }));

  return (
    <div className="evalgraph">
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart
          data={data}
          margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
          onClick={(state) => {
            const idx = state?.activeTooltipIndex;
            if (typeof idx === 'number' && data[idx]) onSeek(data[idx].ply);
          }}
        >
          <defs>
            <linearGradient id="advGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f4f4f4" stopOpacity={0.95} />
              <stop offset="50%" stopColor="#9e9e9e" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#2a2a2a" stopOpacity={0.95} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#3a382f" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="ply" hide />
          <YAxis domain={[-50, 50]} hide />
          <ReferenceLine y={0} stroke="#6b6858" strokeWidth={1} />
          {currentPly > 0 && <ReferenceLine x={currentPly} stroke="#e8a33d" strokeWidth={2} />}
          <Tooltip
            cursor={{ stroke: '#e8a33d', strokeWidth: 1 }}
            contentStyle={{
              background: '#26241f',
              border: '1px solid #3a382f',
              borderRadius: 6,
              fontSize: 12,
            }}
            labelFormatter={(ply) => `Move ${Math.ceil(Number(ply) / 2)}`}
            formatter={(_v, _n, item) => {
              const p = item.payload as (typeof data)[number];
              return [`${p.san}  ${formatEval(p.evalCp)}`, GRADE_META[p.grade].label];
            }}
          />
          <Area
            type="monotone"
            dataKey="advantage"
            stroke="#c9c5b4"
            strokeWidth={1.5}
            fill="url(#advGradient)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
