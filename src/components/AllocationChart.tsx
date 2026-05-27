import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { PortfolioMetrics } from '../types';
import { formatMoney, formatPct } from '../format';

const COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4',
  '#a855f7', '#84cc16', '#f43f5e', '#0ea5e9', '#eab308',
  '#14b8a6', '#f97316', '#8b5cf6', '#22c55e', '#ec4899',
];

interface AllocationChartProps {
  metrics: PortfolioMetrics;
}

interface Slice {
  name: string;
  value: number;
  weight: number;
}

export function AllocationChart({ metrics }: AllocationChartProps) {
  const slices: Slice[] = metrics.holdingsMetrics.map((m) => ({
    name: m.holding.symbol || m.holding.name || '未命名',
    value: m.marketValue,
    weight: m.weight,
  }));
  if (metrics.cashValue > 0) {
    slices.push({
      name: '现金',
      value: metrics.cashValue,
      weight: metrics.cashWeight,
    });
  }

  if (slices.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-slate-500">
        添加持仓或现金后，这里将显示占比饼图。
      </div>
    );
  }

  return (
    <div className="h-72 w-full sm:h-96">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="45%"
            outerRadius="80%"
            paddingAngle={2}
            label={(entry) => {
              const slice = entry as unknown as Slice;
              return `${slice.name} ${formatPct(slice.weight)}`;
            }}
          >
            {slices.map((s, i) => (
              <Cell
                key={s.name}
                fill={s.name === '现金' ? '#94a3b8' : COLORS[i % COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, _name, item) => {
              const slice = item.payload as Slice;
              const num = typeof value === 'number' ? value : Number(value);
              return [`${formatMoney(num)} (${formatPct(slice.weight)})`, slice.name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
