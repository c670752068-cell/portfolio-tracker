import { useEffect, useRef, useState } from 'react';
import { Cell, Legend, Pie, PieChart, Tooltip } from 'recharts';
import type { PortfolioMetrics } from '../types';
import { formatMoney, formatPct } from '../format';
import { buildAllocationSlices, type AllocationSlice } from '../allocation';

const COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4',
  '#a855f7', '#84cc16', '#f43f5e', '#0ea5e9', '#eab308',
  '#14b8a6', '#f97316', '#8b5cf6', '#22c55e', '#ec4899',
];

interface AllocationChartProps {
  metrics: PortfolioMetrics;
}

export function AllocationChart({ metrics }: AllocationChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const slices = buildAllocationSlices(metrics);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
      });
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [slices.length]);

  if (slices.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-slate-500">
        添加持仓或现金后，这里将显示占比饼图。
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-72 min-h-72 w-full min-w-0 sm:h-96">
      {size.width > 1 && size.height > 1 && (
        <PieChart width={size.width} height={size.height}>
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
              const slice = entry as unknown as AllocationSlice;
              return slice.showLabel ? `${slice.name} ${formatPct(slice.weight)}` : null;
            }}
          >
            {slices.map((s, i) => (
              <Cell
                key={`${i}-${s.name}`}
                fill={s.kind === 'cash' ? '#94a3b8' : s.kind === 'cash-equivalent' ? '#64748b' : COLORS[i % COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, _name, item) => {
              const slice = item.payload as AllocationSlice;
              const num = typeof value === 'number' ? value : Number(value);
              return [`${formatMoney(num)} (${formatPct(slice.weight)})`, slice.name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
        </PieChart>
      )}
    </div>
  );
}
