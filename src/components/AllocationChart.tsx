import { useEffect, useRef, useState } from 'react';
import { Cell, Legend, Pie, PieChart, Tooltip } from 'recharts';
import type { DisplayCurrency, ExchangeRates, PortfolioMetrics } from '../types';
import { formatPct } from '../format';
import { buildAllocationSlices, type AllocationSlice } from '../allocation';
import { formatDisplayMoney } from '../displayCurrency';

const COLORS = [
  'var(--color-buy)', 'var(--color-gain)', 'var(--color-trim)', 'var(--color-loss)',
  'color-mix(in srgb, var(--color-buy) 72%, var(--color-neutral))',
  'color-mix(in srgb, var(--color-gain) 72%, var(--color-neutral))',
  'color-mix(in srgb, var(--color-trim) 72%, var(--color-neutral))',
  'color-mix(in srgb, var(--color-loss) 72%, var(--color-neutral))',
  'color-mix(in srgb, var(--color-buy) 48%, var(--color-ink-muted))',
  'color-mix(in srgb, var(--color-gain) 48%, var(--color-ink-muted))',
  'color-mix(in srgb, var(--color-trim) 48%, var(--color-ink-muted))',
  'color-mix(in srgb, var(--color-loss) 48%, var(--color-ink-muted))',
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
      <div className="flex h-72 items-center justify-center text-sm text-ink-muted">
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
            className="font-mono tabular-nums"
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
              contentStyle={{
                backgroundColor: 'var(--color-surface-raised)',
                borderColor: 'color-mix(in srgb, var(--color-neutral) 60%, transparent)',
                borderRadius: '0.75rem',
                color: 'var(--color-ink-primary)',
                fontSize: '0.75rem',
              }}
              labelStyle={{ color: 'var(--color-ink-secondary)' }}
              itemStyle={{ color: 'var(--color-ink-primary)' }}
            />
            {!isNarrow && (
              <Legend
                iconSize={8}
                wrapperStyle={{
                  color: 'var(--color-ink-secondary)',
                  fontSize: '0.75rem',
                  lineHeight: '1.5rem',
                }}
              />
            )}
          </PieChart>
          {isNarrow && (
            <div className="grid grid-cols-1 divide-y divide-neutral/30 overflow-hidden rounded-xl border border-neutral/30 bg-surface-base px-3 text-xs min-[480px]:grid-cols-2 min-[480px]:divide-y-0">
              {detailSlices.map((slice) => {
                const index = slices.indexOf(slice);
                return (
                  <div key={slice.name} className="flex min-w-0 items-start gap-2 py-2 min-[480px]:px-2">
                    <span
                      className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: sliceColor(slice, index) }}
                    />
                    <span className="min-w-0 flex-1 break-words leading-tight text-ink-secondary" title={slice.name}>{slice.name}</span>
                    <span className="shrink-0 text-right font-mono font-medium tabular-nums text-ink-primary">
                      <span className="block">{formatPct(slice.weight)}</span>
                      <span className="block text-[10px] font-normal text-ink-muted">{formatDisplayMoney(slice.value, displayCurrency, rates)}</span>
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
  if (slice.kind === 'cash') return 'var(--color-cash)';
  if (slice.kind === 'cash-equivalent') return 'color-mix(in srgb, var(--color-cash) 72%, var(--color-ink-muted))';
  return COLORS[index % COLORS.length];
}
