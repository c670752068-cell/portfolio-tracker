import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { QuantValuationTab } from '../types';

interface ValuationChartsProps {
  valuation: QuantValuationTab;
}

const CHART_TOOLTIP_STYLE = {
  background: 'var(--color-surface-raised)',
  border: '1px solid color-mix(in srgb, var(--color-neutral) 55%, transparent)',
  borderRadius: 12,
  color: 'var(--color-ink-primary)',
  fontSize: 12,
} as const;

export function ValuationCharts({ valuation }: ValuationChartsProps) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <PeHistoryChart valuation={valuation} />
      <CnnHistoryChart valuation={valuation} />
    </div>
  );
}

function PeHistoryChart({ valuation }: ValuationChartsProps) {
  const history = valuation.ndx.history.filter((item) => item.pe !== null);
  const tariff = valuation.anchors.find((item) => item.label.includes('2025-04'));
  return (
    <ChartCard
      title="三年 PE 走势"
      meta={`丹居 · ${coverageText(history.map((item) => item.date))}`}
      empty={history.length === 0}
    >
      <div className="min-w-[620px]">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={history} margin={{ top: 22, right: 20, bottom: 10, left: 0 }}>
            <CartesianGrid stroke="var(--color-neutral)" strokeOpacity={0.22} vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={44} tick={axisTick()} />
            <YAxis domain={['auto', 'auto']} width={42} tick={axisTick()} />
            <Tooltip
              contentStyle={CHART_TOOLTIP_STYLE}
              formatter={(value) => [`${formatNumber(value)} PE`, '纳指100']}
              labelFormatter={(label) => String(label)}
            />
            <ReferenceLine y={valuation.ndx.percentile_lines.p30 ?? undefined} stroke="var(--color-gain)" strokeDasharray="5 5" label={lineLabel('30分位')} />
            <ReferenceLine y={valuation.ndx.percentile_lines.median ?? undefined} stroke="var(--color-neutral)" strokeDasharray="5 5" label={lineLabel('中位')} />
            <ReferenceLine y={valuation.ndx.percentile_lines.p70 ?? undefined} stroke="var(--color-loss)" strokeDasharray="5 5" label={lineLabel('70分位')} />
            {tariff?.date && tariff.ndx_pe !== undefined && (
              <ReferenceDot
                x={tariff.date}
                y={tariff.ndx_pe}
                r={5}
                fill="var(--color-buy)"
                stroke="var(--color-surface-raised)"
                label={{ value: '2025-04 关税低点', position: 'top', fill: 'var(--color-buy)', fontSize: 11 }}
              />
            )}
            <Line type="monotone" dataKey="pe" stroke="var(--color-buy)" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function CnnHistoryChart({ valuation }: ValuationChartsProps) {
  const history = valuation.cnn.history.filter((item) => item.score !== null);
  return (
    <ChartCard
      title="CNN 恐慌贪婪 · 近1年"
      meta={`CNN · ${coverageText(history.map((item) => item.date))}`}
      empty={history.length === 0}
    >
      <div className="min-w-[620px]">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={history} margin={{ top: 22, right: 20, bottom: 10, left: 0 }}>
            <CartesianGrid stroke="var(--color-neutral)" strokeOpacity={0.22} vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={44} tick={axisTick()} />
            <YAxis domain={[0, 100]} width={38} tick={axisTick()} />
            <Tooltip
              contentStyle={CHART_TOOLTIP_STYLE}
              formatter={(value) => [`${formatNumber(value)} / 100`, 'CNN']}
              labelFormatter={(label) => String(label)}
            />
            <ReferenceLine y={25} stroke="var(--color-buy)" strokeDasharray="5 5" label={lineLabel('恐惧 25')} />
            <ReferenceLine y={75} stroke="var(--color-trim)" strokeDasharray="5 5" label={lineLabel('贪婪 75')} />
            <Line type="monotone" dataKey="score" stroke="var(--color-ink-secondary)" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: 'var(--color-buy)' }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function ChartCard({
  title,
  meta,
  empty,
  children,
}: {
  title: string;
  meta: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-neutral/40 bg-surface-raised p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">{title}</h3>
        <span className="font-mono text-[11px] tabular-nums text-ink-muted">{meta}</span>
      </div>
      {empty ? (
        <div className="grid min-h-56 place-items-center rounded-xl bg-surface-overlay/40 text-sm text-ink-muted">
          历史数据准备中
        </div>
      ) : (
        <div className="overflow-x-auto overscroll-x-contain">{children}</div>
      )}
    </section>
  );
}

function coverageText(dates: readonly string[]): string {
  if (dates.length === 0) return '数据准备中';
  return `${dates[0]} 至 ${dates[dates.length - 1]}`;
}

function shortDate(value: string): string {
  return value.slice(2, 7);
}

function formatNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '暂无';
}

function axisTick() {
  return { fill: 'var(--color-ink-muted)', fontSize: 11, fontFamily: 'SF Mono, monospace' };
}

function lineLabel(value: string) {
  return { value, position: 'insideTopRight' as const, fill: 'var(--color-ink-muted)', fontSize: 10 };
}
