import { useMemo } from 'react';
import {
  CartesianGrid,
  Brush,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PeHistoryEntry, PeHistoryPayload, PePoint } from '../peData';
import { pePosition } from '../decisionIndicators';
import { PePositionView } from './DecisionIndicatorViews';

interface Props {
  compact?: boolean;
  symbol: string;
  history?: PeHistoryPayload;
}

const TOOLTIP_STYLE = {
  background: 'var(--color-surface-raised)',
  border: '1px solid color-mix(in srgb, var(--color-neutral) 55%, transparent)',
  borderRadius: 12,
  color: 'var(--color-ink-primary)',
  fontSize: 12,
} as const;

export function StockTtmValuationView({ symbol, history, compact = false }: Props) {
  const entry = history?.symbols[symbol];
  if (history?.metric !== 'ttm_pe' || !entry || entry.current === null || entry.series.length === 0) {
    return <Unavailable symbol={symbol} />;
  }
  return <Available symbol={symbol} history={history} entry={entry as PeHistoryEntry & { current: number }} compact={compact} />;
}

function Available({ symbol, history, entry, compact }: {
  compact: boolean;
  symbol: string;
  history: PeHistoryPayload;
  entry: PeHistoryEntry & { current: number };
}) {
  const diagnostics = useMemo(() => analyse(entry.series), [entry.series]);
  const position = classifyPercentile(entry.percentile);
  const latest = entry.series.at(-1);

  return (
    <>
      {entry.basis_note && <p className="mb-3 rounded-lg border border-neutral/35 bg-surface-overlay px-3 py-2 text-xs leading-relaxed text-ink-secondary" data-testid="pe-basis-note">{entry.basis_note}</p>}
      {compact ? <div className="pe-history-position-summary" aria-label={`${symbol} · TTM PE`}>
        <div><h3 className="text-sm font-semibold">当前 TTM PE · 历史位置</h3><p className="decision-note">从左侧低位到右侧高位，圆点是当前所处位置。分位不是上涨概率。</p><p className="sr-only">当前 TTM PE {entry.current.toFixed(2)} · 5年历史分位 {formatPercentile(entry.percentile)}</p></div>
        <PePositionView value={pePosition(symbol, history)} />
      </div> : <><div className={`rounded-xl border p-4 ${position.className}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-lg font-bold sm:text-xl">{symbol} · TTM PE · {position.label}</div><p className="mt-1 text-sm font-semibold text-ink-primary">5年分位 {formatPercentile(entry.percentile)}</p></div><div className="text-right tabular-nums"><div className="text-2xl font-bold sm:text-3xl">{entry.current.toFixed(2)}</div><div className="text-[10px] text-ink-muted sm:text-xs">当前 TTM PE {entry.current.toFixed(2)}</div></div></div></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><Band label="30% 位" value={diagnostics.q30} /><Band label="历史中位" value={diagnostics.median} active /><Band label="70% 位" value={diagnostics.q70} /></div></>}

      <div className="mt-4 overflow-x-auto overscroll-x-contain">
        <div className="min-w-[620px]">
          <ResponsiveContainer width="100%" height={compact ? 380 : 300} initialDimension={{ width: 900, height: compact ? 380 : 300 }}>
            <LineChart data={entry.series} margin={{ top: 20, right: 28, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="var(--color-neutral)" strokeOpacity={0.2} vertical={false} />
              <XAxis dataKey="date" tickFormatter={(value) => compact ? String(value).slice(2) : String(value).slice(2, 7)} minTickGap={42} interval="preserveStartEnd" tick={axisTick()} />
              <YAxis domain={diagnostics.domain} width={48} tick={axisTick()} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [`${formatNumber(value)} PE`, symbol]} />
              <ReferenceLine y={diagnostics.q30} stroke={compact ? '#059669' : 'var(--color-gain)'} strokeDasharray="5 5" />
              <ReferenceLine y={diagnostics.median} stroke={compact ? 'var(--color-buy)' : 'var(--color-neutral)'} strokeDasharray="5 5" />
              <ReferenceLine y={diagnostics.q70} stroke={compact ? '#d97706' : 'var(--color-trim)'} strokeDasharray="5 5" />
              <Line type="linear" dataKey="value" stroke="var(--color-ink-primary)" strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              {latest && <ReferenceDot x={latest.date} y={latest.value} r={5} fill="var(--color-buy)" stroke="var(--color-surface-raised)" />}
              {compact && <Brush dataKey="date" height={28} stroke="#8b5cf6" fill="var(--color-surface-overlay)" tickFormatter={(value) => String(value).slice(2)}><LineChart><Line dataKey="value" stroke="#a78bfa" dot={false} isAnimationActive={false} /></LineChart></Brush>}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      {compact && <div className="mt-3 flex flex-wrap justify-center gap-5 text-xs tabular-nums"><span className="text-emerald-600">┄ 30% 分位 {diagnostics.q30.toFixed(2)}</span><span className="text-buy">┄ 历史中位 {diagnostics.median.toFixed(2)}</span><span className="text-amber-600">┄ 70% 分位 {diagnostics.q70.toFixed(2)}</span></div>}

      <div className="mt-3 flex flex-wrap justify-between gap-2 text-[10px] text-ink-muted sm:text-xs">
        <span>数据：{entry.source} · {entry.frequency} · {entry.series_start} 至 {entry.series_end ?? latest?.date ?? '暂无'}</span>
        <span>{history.lookback_years}年原始曲线 · 不平滑、不补点</span>
      </div>
      {diagnostics.largeJumpCount > 0 && (
        <p className="mt-2 rounded-lg border border-trim/30 bg-trim/10 px-3 py-2 text-[10px] text-ink-muted sm:text-xs">
          检测到 {diagnostics.largeJumpCount} 次单日变化≥25%；已保留原始数据。TTM PE 可在财报后因滚动 EPS 更新出现跳变。
        </p>
      )}
      {compact && <p className="mt-3 text-xs leading-relaxed text-ink-muted">TTM 与远期 PE 口径独立；预测数据缺失时显示“暂无数据”。PE 用于查看，不作为新增买入否决条件。</p>}
    </>
  );
}

function Band({ label, value, active = false, compact = false }: { label: string; value: number; active?: boolean; compact?: boolean }) {
  return (
    <div className={compact ? `border-neutral/30 sm:border-l sm:pl-4 ${active ? 'text-buy' : ''}` : `rounded-lg border px-2 py-2 ${active ? 'border-buy/45 bg-buy/10' : 'border-neutral/30 bg-surface-overlay/45'}`}>
      <div className="text-[10px] text-ink-muted sm:text-xs">{label}</div>
      <div className={compact ? 'mt-1 text-xl font-bold tabular-nums sm:text-2xl' : 'mt-0.5 text-xs font-bold tabular-nums sm:text-sm'}>{value.toFixed(2)}</div>
    </div>
  );
}

function Unavailable({ symbol }: { symbol: string }) {
  return (
    <div className="grid min-h-64 place-items-center rounded-xl border border-neutral/35 bg-surface-overlay/45 p-6 text-center">
      <div>
        <div className="text-lg font-bold">{symbol} · TTM PE 历史暂不可用</div>
        <p className="mt-2 text-sm text-ink-muted">等待下一次量化数据同步，可先切换到远期市盈率。</p>
      </div>
    </div>
  );
}

function classifyPercentile(percentile: number | null) {
  if (percentile === null) return { label: '分位待定', className: 'border-neutral/45 bg-surface-overlay text-ink-primary' };
  if (percentile <= 20) return { label: '历史低位', className: 'border-buy/45 bg-buy/10 text-buy' };
  if (percentile <= 40) return { label: '历史偏低', className: 'border-gain/40 bg-gain/10 text-gain' };
  if (percentile < 70) return { label: '历史中位', className: 'border-neutral/50 bg-surface-overlay text-ink-primary' };
  if (percentile < 90) return { label: '历史偏高', className: 'border-trim/45 bg-trim/10 text-trim' };
  return { label: '历史高位', className: 'border-loss/50 bg-loss/10 text-loss' };
}

function analyse(series: PePoint[]) {
  const values = series.map((point) => point.value).filter(Number.isFinite).sort((a, b) => a - b);
  const q30 = quantile(values, 0.3);
  const median = quantile(values, 0.5);
  const q70 = quantile(values, 0.7);
  const floor = values[0] ?? 0;
  const ceiling = values.at(-1) ?? 1;
  let largeJumpCount = 0;
  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1].value;
    if (previous > 0 && Math.abs(series[index].value / previous - 1) >= 0.25) largeJumpCount += 1;
  }
  return {
    q30,
    median,
    q70,
    largeJumpCount,
    domain: [Math.max(0, Math.floor(floor * 0.92)), Math.ceil(ceiling * 1.08)] as [number, number],
  };
}

function quantile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function formatPercentile(value: number | null): string {
  return value === null ? '暂无' : `${value.toFixed(1)}%`;
}

function formatNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '暂无';
}

function axisTick() {
  return { fill: 'var(--color-ink-muted)', fontSize: 11, fontFamily: 'SF Mono, monospace' };
}
