import { useState } from 'react';
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
import type { PeHistoryEntry, PeHistoryPayload } from '../peData';
import type { QuantForwardPeHistory, QuantValuationTab } from '../types';
import { alignValuationHistoryAsOf } from '../valuationPlan';

type PeMetricView = 'ttm' | 'forward';
type IndexKey = 'NDX' | 'SOX';

interface ValuationChartsProps {
  valuation: QuantValuationTab;
  ttmHistory?: PeHistoryPayload;
  forwardHistory?: QuantForwardPeHistory;
  /** Test-only initial value. Real browsers resolve this from ?pe=forward. */
  initialMetric?: PeMetricView;
}

const CHART_TOOLTIP_STYLE = {
  background: 'var(--color-surface-raised)',
  border: '1px solid color-mix(in srgb, var(--color-neutral) 55%, transparent)',
  borderRadius: 12,
  color: 'var(--color-ink-primary)',
  fontSize: 12,
} as const;

export function ValuationCharts({ valuation, ttmHistory, forwardHistory, initialMetric }: ValuationChartsProps) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <PeHistoryChart
        valuation={valuation}
        ttmHistory={ttmHistory}
        forwardHistory={forwardHistory}
        initialMetric={initialMetric}
      />
      <CnnHistoryChart valuation={valuation} />
    </div>
  );
}

function PeHistoryChart({
  valuation,
  ttmHistory,
  forwardHistory,
  initialMetric,
}: ValuationChartsProps) {
  const [metric, setMetric] = useState<PeMetricView>(() => initialMetric ?? metricFromUrl());
  const [index, setIndex] = useState<IndexKey>('NDX');
  const ttm = ttmSeries(valuation, ttmHistory, index);
  const forward = forwardHistory?.symbols[index];
  const isForward = metric === 'forward';
  const history = isForward
    ? (forward?.series ?? []).map((item) => ({ date: item.date, value: item.value }))
    : ttm.series.map((item) => ({ date: item.date, value: item.pe }));
  const current = isForward ? (forward?.current ?? null) : ttm.current;
  const p30 = isForward ? null : valuation.ndx.percentile_lines.p30;
  const median = isForward ? null : valuation.ndx.percentile_lines.median;
  const p70 = isForward ? null : valuation.ndx.percentile_lines.p70;
  const tariff = !isForward && index === 'NDX'
    ? valuation.anchors.find((item) => item.label.includes('2025-04'))
    : undefined;
  const title = isForward
    ? forwardHistory?.history_ready ? '远期 PE 走势' : '远期 PE（积累中）'
    : `${yearsLabel(history.map((item) => item.date))} PE 走势`;
  const source = isForward ? 'Yahoo · 市值加权近似' : `丹居 · ${coverageText(history.map((item) => item.date))}`;
  const empty = history.length === 0;
  const noPercentile = isForward && !forwardHistory?.history_ready;

  function chooseMetric(next: PeMetricView) {
    setMetric(next);
    updateMetricUrl(next);
  }

  return (
    <ChartCard title={title} meta={source}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-neutral/50 bg-surface-overlay/50 p-0.5" aria-label="PE 口径">
          <SegmentButton active={!isForward} onClick={() => chooseMetric('ttm')}>TTM</SegmentButton>
          <SegmentButton active={isForward} onClick={() => chooseMetric('forward')}>远期</SegmentButton>
        </div>
        <div className="inline-flex rounded-lg border border-neutral/50 bg-surface-overlay/50 p-0.5" aria-label="指数标的">
          <SegmentButton active={index === 'NDX'} onClick={() => setIndex('NDX')}>NDX</SegmentButton>
          <SegmentButton active={index === 'SOX'} onClick={() => setIndex('SOX')}>SOX</SegmentButton>
        </div>
      </div>
      {!isForward && index === 'NDX' && valuation.ndx.stale && (
        <p className="mb-4 rounded-lg border border-trim/40 bg-trim/10 px-3 py-2 text-xs text-ink-secondary">
          ⚠ 数据停留在 {valuation.ndx.as_of ?? '未知日期'}（{valuation.ndx.stale_days ?? 0} 天前）
          {valuation.ndx.gate_available === false ? '；估值闸门当前不可判定' : ''}
        </p>
      )}
      {isForward && (
        <div className="mb-4 space-y-2 rounded-lg border border-neutral/40 bg-surface-overlay/35 p-3 text-xs leading-relaxed text-ink-secondary">
          <div className="font-mono tabular-nums">
            当前 {formatNumber(current)}
            {noPercentile ? ` · ${forward?.percentile_unavailable_reason ?? '历史积累中'}` : ` · 分位 ${formatNumber(forward?.percentile ?? null)}`}
          </div>
          <p>ⓘ {forwardHistory?.approximation_note ?? '近似方法说明暂无'}</p>
          <p className="text-ink-muted">已用 {forward?.constituents_used ?? 0} 个成分，剔除 {forward?.constituents_excluded ?? 0} 个；覆盖率 {formatPercent(forward?.weight_coverage_pct ?? null)}（限预设成分名单，非官方指数权重）。</p>
        </div>
      )}
      {empty ? (
        <div className="grid min-h-56 place-items-center rounded-xl bg-surface-overlay/40 text-sm text-ink-muted">历史数据准备中</div>
      ) : (
        <div className="overflow-x-auto overscroll-x-contain">
          <div className="min-w-[620px]">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={history} margin={{ top: 22, right: 20, bottom: 10, left: 0 }}>
                <CartesianGrid stroke="var(--color-neutral)" strokeOpacity={0.22} vertical={false} />
                <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={44} tick={axisTick()} />
                <YAxis domain={['auto', 'auto']} width={42} tick={axisTick()} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(value) => [`${formatNumber(value)} PE`, index]} labelFormatter={(label) => String(label)} />
                <ReferenceLine y={p30 ?? undefined} stroke="var(--color-gain)" strokeDasharray="5 5" label={lineLabel('30分位')} />
                <ReferenceLine y={median ?? undefined} stroke="var(--color-neutral)" strokeDasharray="5 5" label={lineLabel('中位')} />
                <ReferenceLine y={p70 ?? undefined} stroke="var(--color-loss)" strokeDasharray="5 5" label={lineLabel('70分位')} />
                {tariff?.date && tariff.ndx_pe !== undefined && (
                  <ReferenceDot x={tariff.date} y={tariff.ndx_pe} r={5} fill="var(--color-buy)" stroke="var(--color-surface-raised)" label={{ value: '2025-04 关税低点', position: 'top', fill: 'var(--color-buy)', fontSize: 11 }} />
                )}
                <Line type="monotone" dataKey="value" stroke="var(--color-buy)" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      {!isForward && <p className="mt-3 font-mono text-xs tabular-nums text-ink-muted">当前 {formatNumber(current)} · 5年分位 {index === 'NDX' ? formatNumber(valuation.ndx.pe_percentile_5y) : formatNumber(ttm.percentile)}</p>}
    </ChartCard>
  );
}

function ttmSeries(valuation: QuantValuationTab, history: PeHistoryPayload | undefined, index: IndexKey) {
  if (index === 'NDX') {
    const points = alignValuationHistoryAsOf(valuation.ndx.history, valuation.ndx.as_of, valuation.ndx.current_pe, valuation.ndx.current_pb)
      .filter((item) => item.pe !== null)
      .map((item) => ({ date: item.date, pe: item.pe as number }));
    return { series: points, current: valuation.ndx.current_pe, percentile: valuation.ndx.pe_percentile_5y };
  }
  const entry: PeHistoryEntry | undefined = history?.symbols.SOX;
  return {
    series: (entry?.series ?? []).map((item) => ({ date: item.date, pe: item.value })),
    current: entry?.current ?? null,
    percentile: entry?.percentile ?? null,
  };
}

function CnnHistoryChart({ valuation }: { valuation: QuantValuationTab }) {
  const history = valuation.cnn.history.filter((item) => item.score !== null);
  return (
    <ChartCard title="CNN 恐慌贪婪 · 近1年" meta={`CNN · ${coverageText(history.map((item) => item.date))}`}>
      <div className="overflow-x-auto overscroll-x-contain"><div className="min-w-[620px]"><ResponsiveContainer width="100%" height={280}><LineChart data={history} margin={{ top: 22, right: 20, bottom: 10, left: 0 }}>
        <CartesianGrid stroke="var(--color-neutral)" strokeOpacity={0.22} vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={44} tick={axisTick()} />
        <YAxis domain={[0, 100]} width={38} tick={axisTick()} />
        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(value) => [`${formatNumber(value)} / 100`, 'CNN']} labelFormatter={(label) => String(label)} />
        <ReferenceLine y={25} stroke="var(--color-buy)" strokeDasharray="5 5" label={lineLabel('恐惧 25')} />
        <ReferenceLine y={75} stroke="var(--color-trim)" strokeDasharray="5 5" label={lineLabel('贪婪 75')} />
        <Line type="monotone" dataKey="score" stroke="var(--color-ink-secondary)" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: 'var(--color-buy)' }} isAnimationActive={false} />
      </LineChart></ResponsiveContainer></div></div>
    </ChartCard>
  );
}

function SegmentButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-[transform,background-color,color] duration-150 ease-out active:scale-[0.97] ${active ? 'bg-surface-raised text-ink-primary shadow-sm' : 'text-ink-muted hover:text-ink-primary'}`}>{children}</button>;
}

function ChartCard({ title, meta, children }: { title: string; meta: string; children: React.ReactNode }) {
  return <section className="overflow-hidden rounded-2xl border border-neutral/40 bg-surface-raised p-4 sm:p-5"><div className="mb-4 flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-base font-semibold">{title}</h3><span className="font-mono text-[11px] tabular-nums text-ink-muted">{meta}</span></div>{children}</section>;
}

function metricFromUrl(): PeMetricView {
  if (typeof window === 'undefined') return 'ttm';
  return new URLSearchParams(window.location.search).get('pe') === 'forward' ? 'forward' : 'ttm';
}

function updateMetricUrl(metric: PeMetricView): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (metric === 'forward') url.searchParams.set('pe', 'forward'); else url.searchParams.delete('pe');
  window.history.replaceState(null, '', url);
}

function yearsLabel(dates: readonly string[]): string {
  if (dates.length < 2) return '历史';
  const start = new Date(dates[0]).getUTCFullYear();
  const end = new Date(dates[dates.length - 1]).getUTCFullYear();
  return `${Math.max(1, end - start)} 年`;
}
function coverageText(dates: readonly string[]): string { return dates.length === 0 ? '数据准备中' : `${dates[0]} 至 ${dates[dates.length - 1]}`; }
function shortDate(value: string): string { return value.slice(2, 7); }
function formatNumber(value: unknown): string { return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '暂无'; }
function formatPercent(value: number | null): string { return value === null || !Number.isFinite(value) ? '暂无' : `${value.toFixed(2)}%`; }
function axisTick() { return { fill: 'var(--color-ink-muted)', fontSize: 11, fontFamily: 'SF Mono, monospace' }; }
function lineLabel(value: string) { return { value, position: 'insideTopRight' as const, fill: 'var(--color-ink-muted)', fontSize: 10 }; }
