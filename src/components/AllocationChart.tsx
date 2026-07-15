import { useEffect, useRef, useState } from 'react';
import { Cell, Legend, Pie, PieChart, Tooltip } from 'recharts';
import type { DisplayCurrency, ExchangeRates, PortfolioMetrics } from '../types';
import { formatPct } from '../format';
import { buildAllocationSlices, type AllocationSlice } from '../allocation';
import { formatDisplayMoney } from '../displayCurrency';

const COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4',
  '#a855f7', '#84cc16', '#f43f5e', '#0ea5e9', '#eab308',
  '#14b8a6', '#f97316', '#8b5cf6', '#22c55e', '#ec4899',
];

interface AllocationChartProps {
  metrics: PortfolioMetrics;
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
}

export function AllocationChart({ metrics, displayCurrency, rates }: AllocationChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const slices = buildAllocationSlices(metrics);
  const isNarrow = size.width > 0 && size.width < 520;
  const detailSlices = [...slices].sort((left, right) => right.value - left.value);

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
    <div ref={containerRef} className="min-h-72 w-full min-w-0 sm:h-96">
      {size.width > 1 && size.height > 1 && (
        <>
          <PieChart
            width={size.width}
            height={isNarrow ? 220 : size.height}
            margin={isNarrow ? undefined : { top: 24, right: 24, bottom: 24, left: 24 }}
          >
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="45%"
              outerRadius={isNarrow ? '82%' : '72%'}
              paddingAngle={2}
              label={isNarrow ? false : (entry) => {
                const slice = entry as unknown as AllocationSlice;
                return slice.showLabel ? `${slice.name} ${formatPct(slice.weight)}` : null;
              }}
            >
              {slices.map((s, i) => (
                <Cell key={`${i}-${s.name}`} fill={sliceColor(s, i)} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, _name, item) => {
                const slice = item.payload as AllocationSlice;
                const num = typeof value === 'number' ? value : Number(value);
                return [`${formatDisplayMoney(num, displayCurrency, rates)} (${formatPct(slice.weight)})`, slice.name];
              }}
            />
            {!isNarrow && <Legend wrapperStyle={{ fontSize: '0.75rem' }} />}
          </PieChart>
          {isNarrow && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 pb-2 text-xs">
              {detailSlices.map((slice) => {
                const index = slices.indexOf(slice);
                return (
                  <div key={slice.name} className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: sliceColor(slice, index) }}
                    />
                    <span className="min-w-0 flex-1 truncate text-slate-600" title={slice.name}>{slice.name}</span>
                    <span className="shrink-0 text-right font-medium text-slate-800">
                      <span className="block">{formatPct(slice.weight)}</span>
                      <span className="block text-[10px] font-normal text-slate-500">{formatDisplayMoney(slice.value, displayCurrency, rates)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function sliceColor(slice: AllocationSlice, index: number): string {
  if (slice.kind === 'cash') return '#94a3b8';
  if (slice.kind === 'cash-equivalent') return '#64748b';
  return COLORS[index % COLORS.length];
}
