import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  QuantForwardPeEntry,
  QuantForwardPeHistory,
  QuantIndexEtfValuation,
  QuantStockForwardEntry,
  QuantStockForwardValuation,
  QuantStockForwardZone,
} from '../types';
import type { PeHistoryPayload } from '../peData';
import { StockTtmValuationView } from './StockTtmValuationView';
import { IndexEtfValuationView } from './IndexEtfValuationView';
import { sourceTime } from '../dataFreshness';
import { SYMBOL_NAMES } from '../technicalSymbols';
import { INDEX_PE_SYMBOLS, PE_HISTORY_PROXIES, PE_NOT_APPLICABLE, resolvePeEntry, resolveIssuerPeEntry } from '../decisionIndicators';

interface Props {
  compact?: boolean;
  valuation?: QuantStockForwardValuation | null;
  ttmHistory?: PeHistoryPayload;
  forwardIndexHistory?: QuantForwardPeHistory;
  indexEtfValuation?: QuantIndexEtfValuation;
  initialMetric?: 'ttm' | 'forward';
  selectedSymbol?: string;
  onSelectedSymbolChange?: (symbol: string) => void;
}

const COMPANY_NAMES: Record<string, string> = {
  NVDA: '英伟达',
  AAPL: '苹果',
  GOOG: 'Google',
  META: 'Meta',
  TSLA: '特斯拉',
  AMZN: '亚马逊',
  MSFT: '微软',
  AVGO: '博通',
  MU: '美光',
  TSM: '台积电',
  NDX: '纳指100',
  SOX: '费城半导体',
  SPX: '标普500',
};

const PREFERRED_ORDER = ['NVDA', 'AAPL', 'GOOG', 'META', 'TSLA', 'AMZN', 'MSFT', 'AVGO', 'MU', 'TSM', 'NDX', 'SOX', 'SPX', 'DIA', 'VOO'];
const INDEX_SYMBOLS = INDEX_PE_SYMBOLS;

const ZONE_CLASS: Record<QuantStockForwardZone, string> = {
  extreme_low: 'border-buy/45 bg-buy/10 text-buy',
  low: 'border-gain/40 bg-gain/10 text-gain',
  middle: 'border-neutral/50 bg-surface-overlay text-ink-primary',
  high: 'border-trim/45 bg-trim/10 text-trim',
  ultra_high: 'border-loss/50 bg-loss/10 text-loss',
  exempt: 'border-neutral/50 bg-surface-overlay text-ink-primary',
};

const TOOLTIP_STYLE = {
  background: 'var(--color-surface-raised)',
  border: '1px solid color-mix(in srgb, var(--color-neutral) 55%, transparent)',
  borderRadius: 12,
  color: 'var(--color-ink-primary)',
  fontSize: 12,
} as const;

export function StockForwardValuationExplorer({
  valuation,
  ttmHistory,
  forwardIndexHistory,
  indexEtfValuation,
  initialMetric = 'ttm',
  selectedSymbol,
  onSelectedSymbolChange,
  compact = false,
}: Props) {
  const [metric, setMetric] = useState<'ttm' | 'forward'>(initialMetric);
  const order = useMemo(
    () => [...new Set([...availableSymbols(metric, valuation, ttmHistory, forwardIndexHistory, indexEtfValuation), ...(selectedSymbol ? [selectedSymbol] : [])])],
    [metric, valuation, ttmHistory, forwardIndexHistory, indexEtfValuation, selectedSymbol],
  );
  const [internalSelected, setInternalSelected] = useState(order[0] ?? 'NVDA');
  const requestedSymbol = selectedSymbol ?? internalSelected;
  const category = INDEX_SYMBOLS.has(requestedSymbol) ? 'index' : 'stock';
  const categorySymbols = order.filter((ticker) => INDEX_SYMBOLS.has(ticker) === (category === 'index'));
  const symbol = requestedSymbol;
  const resolvedTtm = resolvePeEntry(symbol, ttmHistory);
  const selectedTtmHistory = ttmHistory && resolvedTtm ? { ...ttmHistory, symbols: { ...ttmHistory.symbols, [symbol]: resolvedTtm } } : ttmHistory;
  const entry = valuation?.symbols[symbol];
  const indexEntry = forwardIndexHistory?.symbols[symbol];
  const issuerEntry = resolvedTtm?.current != null && resolvedTtm.current > 0 && resolvedTtm.series.length ? undefined : resolveIssuerPeEntry(symbol, indexEtfValuation);
  const dataAsOf = issuerEntry ? issuerEntry.as_of : metric === 'ttm'
    ? resolvedTtm?.series_end ?? resolvedTtm?.series.at(-1)?.date
    : isAvailableIndexEntry(indexEntry) ? indexEntry.series_end ?? indexEntry.series.at(-1)?.date : entry?.as_of;

  const selectSymbol = (ticker: string) => {
    setInternalSelected(ticker);
    onSelectedSymbolChange?.(ticker);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-neutral/40 bg-surface-raised" data-testid="pe-history-explorer">
      <header className="border-b border-neutral/30 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            {!compact && <div className="text-[10px] font-bold tracking-[0.2em] text-buy sm:text-xs">VALUATION</div>}
            <h2 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">股票与指数估值 · {issuerEntry ? metric === 'ttm' ? issuerEntry.metric_label ?? '指数 PE' : '远期 PE（FY1）' : metric === 'ttm' ? 'TTM PE 历史位置' : '远期 PE 位置'}</h2>
            <p className="mt-1 text-xs text-ink-muted sm:text-sm">按数据口径独立展示；缺失值不补造</p>
          </div>
          <div className="inline-flex rounded-xl border border-neutral/35 bg-surface-overlay p-1" aria-label="PE 口径切换">
            <MetricButton active={metric === 'ttm'} onClick={() => setMetric('ttm')}>
              {issuerEntry ? issuerEntry.metric_label ?? '指数 PE（官方）' : 'TTM（5年历史）'}
            </MetricButton>
            <MetricButton active={metric === 'forward'} onClick={() => setMetric('forward')}>
              远期（预测）
            </MetricButton>
          </div>
        </div>
        {compact ? <div className="mt-4 flex flex-wrap items-center gap-2">
          {(['stock', 'index'] as const).map((value) => <button type="button" key={value} aria-pressed={category === value} onClick={() => { const first = order.find((ticker) => INDEX_SYMBOLS.has(ticker) === (value === 'index')); if (first) selectSymbol(first); }} className={`min-h-11 rounded-lg px-4 text-sm ${category === value ? 'bg-buy text-white' : 'bg-surface-overlay text-ink-secondary'}`}>{value === 'stock' ? '股票' : '指数'}</button>)}
          <select aria-label="PE 估值标的" value={symbol} onChange={(event) => selectSymbol(event.target.value)} className="min-h-11 max-w-full rounded-lg border border-buy/40 bg-surface-raised px-3 text-sm font-semibold text-buy">{[...new Set([...order, symbol])].map((ticker) => <option key={ticker} value={ticker}>{ticker} · {SYMBOL_NAMES[ticker] ?? COMPANY_NAMES[ticker] ?? ticker}</option>)}</select>
          {categorySymbols.slice(0, 5).filter((ticker) => ticker !== symbol).map((ticker) => (
            <button
              key={ticker}
              type="button"
              aria-pressed={ticker === symbol}
              onClick={() => selectSymbol(ticker)}
              className="hidden min-h-11 rounded-lg bg-surface-overlay px-4 py-2 text-left text-ink-secondary hover:text-ink-primary lg:block"
            >
              <strong className="block text-xs sm:text-sm">{ticker}</strong>
              <span className="mt-0.5 block truncate text-xs opacity-85">{SYMBOL_NAMES[ticker] ?? COMPANY_NAMES[ticker] ?? ticker}</span>
            </button>
          ))}
          {!categorySymbols.length && <span className="text-xs text-ink-muted">此类别暂无可靠估值数据</span>}
        </div> : <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-10">{order.map((ticker) => <button key={ticker} type="button" aria-pressed={ticker === symbol} onClick={() => selectSymbol(ticker)} className={`min-h-12 rounded-xl px-2 py-2 text-left transition active:scale-[.98] ${ticker === symbol ? 'bg-buy text-white shadow-sm' : 'bg-surface-overlay text-ink-secondary hover:text-ink-primary'}`}><strong className="block text-xs sm:text-sm">{ticker}</strong><span className="mt-0.5 block truncate text-xs opacity-85">{SYMBOL_NAMES[ticker] ?? COMPANY_NAMES[ticker] ?? ticker}</span></button>)}</div>}
      </header>

      <div className="p-4 sm:p-5">
        <p className="mb-3 text-xs tabular-nums text-ink-secondary" data-testid="selected-pe-update">
          {symbol} · {issuerEntry ? '发行商数据截至' : metric === 'ttm' ? 'TTM PE 数据截至' : '远期 PE 数据时间'} {sourceTime(dataAsOf)}
          {metric === 'ttm' && <> · 采集更新 {sourceTime(issuerEntry?.fetched_at ?? resolvedTtm?.updated_at)}</>}
        </p>
        {PE_NOT_APPLICABLE[symbol] ? <p className="p-5 text-sm text-ink-secondary">{symbol} · {PE_NOT_APPLICABLE[symbol]}</p> : issuerEntry ? (
          <IndexEtfValuationView entry={issuerEntry} metric={metric} />
        ) : metric === 'ttm' ? (
          <StockTtmValuationView key={symbol} symbol={symbol} history={selectedTtmHistory} compact={compact} />
        ) : isAvailableIndexEntry(indexEntry) && forwardIndexHistory ? (
          <IndexForwardAvailable history={forwardIndexHistory} symbol={symbol} entry={indexEntry} />
        ) : !valuation || !isAvailableEntry(entry) ? (
          <Unavailable symbol={symbol} entry={entry} />
        ) : (
          <Available valuation={valuation} entry={entry} />
        )}
      </div>
    </section>
  );
}

function availableSymbols(
  metric: 'ttm' | 'forward',
  valuation: QuantStockForwardValuation | null | undefined,
  ttmHistory: PeHistoryPayload | undefined,
  forwardIndexHistory: QuantForwardPeHistory | undefined,
  indexEtfValuation: QuantIndexEtfValuation | undefined,
): string[] {
  const available = metric === 'ttm'
    ? new Set(Object.entries(ttmHistory?.symbols ?? {})
      .filter(([, entry]) => entry.current !== null && entry.series.length > 0)
      .map(([symbol]) => symbol))
    : new Set([
      ...Object.entries(valuation?.symbols ?? {})
      .filter(([, entry]) => entry.available && entry.current !== null)
      .map(([symbol]) => symbol),
      ...Object.entries(forwardIndexHistory?.symbols ?? {})
        .filter(([, entry]) => entry.current !== null && entry.series.length > 0)
        .map(([symbol]) => symbol),
    ]);
  // Keep an ETF selected when one PE basis is missing; never substitute another index's values.
  for (const symbol of Object.keys(indexEtfValuation?.symbols ?? {})) available.add(symbol);
  if (ttmHistory?.symbols.VOO) available.add('VOO');
  if (metric === 'ttm') for (const [symbol, basis] of Object.entries(PE_HISTORY_PROXIES)) if (available.has(basis)) available.add(symbol);
  if (available.size === 0) return [];
  return [
    ...PREFERRED_ORDER.filter((symbol) => available.has(symbol)),
    ...[...available].filter((symbol) => !PREFERRED_ORDER.includes(symbol)).sort(),
  ];
}

function IndexForwardAvailable({ history, symbol, entry }: {
  history: QuantForwardPeHistory;
  symbol: string;
  entry: QuantForwardPeEntry & { current: number };
}) {
  const latest = entry.series.at(-1);
  const values = entry.series.map((point) => point.value).filter(Number.isFinite);
  const minimum = Math.min(...values, entry.current);
  const maximum = Math.max(...values, entry.current);
  const padding = Math.max((maximum - minimum) * 0.2, 1);
  const domain: [number, number] = [
    Math.max(0, Math.floor(minimum - padding)),
    Math.ceil(maximum + padding),
  ];
  const accumulated = entry.series.length;
  const ready = accumulated >= history.history_days_required;
  const status = ready ? '历史位置' : '历史积累中';
  const coverage = entry.weight_coverage_pct === null
    ? '权重覆盖暂无'
    : `权重覆盖 ${entry.weight_coverage_pct.toFixed(1)}%`;
  const totalConstituents = entry.constituents_used + entry.constituents_excluded;

  return (
    <>
      <div className="rounded-xl border border-neutral/45 bg-surface-overlay p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-lg font-bold sm:text-xl">{symbol} · 远期 PE · {status}</div>
            <p className="mt-1 text-sm font-semibold text-ink-primary">
              {ready && entry.percentile !== null
                ? `历史分位 ${entry.percentile.toFixed(1)}%，仅作指数估值参考。`
                : '当前只展示真实估值与已积累曲线，不生成买卖提示。'}
            </p>
          </div>
          <div className="text-right tabular-nums">
            <div className="text-2xl font-bold sm:text-3xl">{entry.current.toFixed(2)}</div>
            <div className="text-[10px] text-ink-muted sm:text-xs">当前远期 PE {entry.current.toFixed(2)}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
          <span>{ready ? `历史已积累 ${accumulated} 个交易日` : `历史积累 ${accumulated}/${history.history_days_required} 个交易日，暂不计算历史分位`}</span>
          <span>{entry.constituents_used}/{totalConstituents} 个成分可用 · {coverage}</span>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto overscroll-x-contain">
        <div className="min-w-[620px]">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={entry.series} margin={{ top: 20, right: 28, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="var(--color-neutral)" strokeOpacity={0.2} vertical={false} />
              <XAxis dataKey="date" tickFormatter={(value) => String(value).slice(2, 7)} minTickGap={42} tick={axisTick()} />
              <YAxis domain={domain} width={42} tick={axisTick()} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [`${formatNumber(value)} PE`, symbol]} />
              <Line type="linear" dataKey="value" stroke="var(--color-ink-primary)" strokeWidth={2.5} dot={entry.series.length < 3} activeDot={{ r: 4 }} isAnimationActive={false} />
              {latest && <ReferenceDot x={latest.date} y={latest.value} r={5} fill="var(--color-buy)" stroke="var(--color-surface-raised)" />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-3 space-y-1 text-[10px] leading-relaxed text-ink-muted sm:text-xs">
        <div>数据方法：{history.method} · 更新 {history.generated_at}</div>
        <div>{history.approximation_note}</div>
      </div>
    </>
  );
}

function MetricButton({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-10 rounded-lg px-3 text-[10px] font-semibold transition sm:text-xs ${active ? 'bg-buy text-white shadow-sm' : 'text-ink-muted hover:text-ink-primary'}`}
    >
      {children}
    </button>
  );
}

function Available({ valuation, entry }: {
  valuation: QuantStockForwardValuation;
  entry: QuantStockForwardEntry & { current: number; zone: QuantStockForwardZone };
}) {
  const latest = entry.series.at(-1);
  const domain = useMemo(() => chartDomain(entry, valuation), [entry, valuation]);
  return (
    <>
      <div className={`rounded-xl border p-4 ${ZONE_CLASS[entry.zone]}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-lg font-bold sm:text-xl">{entry.icon} {entry.symbol} · {entry.label}</div>
            <p className="mt-1 text-sm font-semibold text-ink-primary">{entry.message}</p>
          </div>
          <div className="text-right tabular-nums">
            <div className="text-2xl font-bold sm:text-3xl">{entry.current.toFixed(2)}</div>
            <div className="text-[10px] text-ink-muted sm:text-xs">当前远期 PE {entry.current.toFixed(2)}</div>
          </div>
        </div>
      </div>

      <ZoneLegend valuation={valuation} active={entry.zone} />

      <div className="mt-4 overflow-x-auto overscroll-x-contain">
        <div className="min-w-[620px]">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={entry.series} margin={{ top: 20, right: 28, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="var(--color-neutral)" strokeOpacity={0.2} vertical={false} />
              <XAxis dataKey="date" tickFormatter={(value) => String(value).slice(2, 7)} minTickGap={42} tick={axisTick()} />
              <YAxis domain={domain} width={42} tick={axisTick()} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [`${formatNumber(value)} PE`, entry.symbol]} />
              <ReferenceArea y1={domain[0]} y2={valuation.thresholds.full_position_max} fill="var(--color-buy)" fillOpacity={0.08} />
              <ReferenceArea y1={valuation.thresholds.full_position_max} y2={valuation.thresholds.low_max} fill="var(--color-gain)" fillOpacity={0.07} />
              <ReferenceArea y1={valuation.thresholds.low_max} y2={valuation.thresholds.middle_max} fill="var(--color-neutral)" fillOpacity={0.06} />
              <ReferenceArea y1={valuation.thresholds.middle_max} y2={valuation.thresholds.high_max} fill="var(--color-trim)" fillOpacity={0.08} />
              <ReferenceArea y1={valuation.thresholds.high_max} y2={domain[1]} fill="var(--color-loss)" fillOpacity={0.08} />
              <ReferenceLine y={valuation.thresholds.full_position_max} stroke="var(--color-buy)" strokeDasharray="5 5" />
              <ReferenceLine y={valuation.thresholds.low_max} stroke="var(--color-gain)" strokeDasharray="5 5" />
              <ReferenceLine y={valuation.thresholds.middle_max} stroke="var(--color-trim)" strokeDasharray="5 5" />
              <ReferenceLine y={valuation.thresholds.high_max} stroke="var(--color-loss)" strokeDasharray="5 5" />
              <Line type="linear" dataKey="value" stroke="var(--color-ink-primary)" strokeWidth={2.5} dot={entry.series.length < 3} activeDot={{ r: 4 }} isAnimationActive={false} />
              {latest && <ReferenceDot x={latest.date} y={latest.value} r={5} fill="var(--color-buy)" stroke="var(--color-surface-raised)" />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap justify-between gap-2 text-[10px] text-ink-muted sm:text-xs">
        <span>数据：{entry.source} · 更新 {entry.as_of ?? '暂无'}</span>
        <span>{valuation.history_note}</span>
      </div>
      {entry.zone === 'extreme_low' && (
        <p className="mt-2 text-[10px] text-ink-muted sm:text-xs">“目标仓位”指该股在组合中的预设上限，不是整个账户满仓一只股票。</p>
      )}
    </>
  );
}

function ZoneLegend({ valuation, active }: {
  valuation: QuantStockForwardValuation;
  active: QuantStockForwardZone;
}) {
  const t = valuation.thresholds;
  const zones: { key: QuantStockForwardZone; range: string; label: string }[] = [
    { key: 'extreme_low', range: `≤ ${t.full_position_max}`, label: '极低' },
    { key: 'low', range: `${t.full_position_max}–${t.low_max}`, label: '低位' },
    { key: 'middle', range: `${t.low_max}–${t.middle_max}`, label: '中位' },
    { key: 'high', range: `${t.middle_max}–${t.high_max}`, label: '高位' },
    { key: 'ultra_high', range: `≥ ${t.high_max}`, label: '超高' },
  ];
  return (
    <div className="mt-4 grid grid-cols-5 gap-1.5" aria-label="未来 PE 估值区间">
      {zones.map((zone) => (
        <div key={zone.key} className={`rounded-lg border px-1.5 py-2 text-center ${active === zone.key ? ZONE_CLASS[zone.key] : 'border-neutral/30 bg-surface-overlay/45 text-ink-muted'}`}>
          <div className="text-[10px] font-bold sm:text-xs">{zone.label}</div>
          <div className="mt-0.5 text-[9px] tabular-nums sm:text-[10px]">{zone.range}</div>
        </div>
      ))}
    </div>
  );
}

function Unavailable({ symbol, entry }: { symbol: string; entry?: QuantStockForwardEntry }) {
  return (
    <div className="grid min-h-64 place-items-center rounded-xl border border-neutral/35 bg-surface-overlay/45 p-6 text-center">
      <div>
        <div className="text-lg font-bold">{symbol} · 远期 PE 数据不可判定</div>
        <p className="mt-2 text-sm text-ink-muted">{entry?.unavailable_reason ?? '等待下一次量化数据同步。'}</p>
        <p className="mt-1 text-xs text-ink-muted">不使用 TTM PE 或过期数据代替，也不生成买卖提示。</p>
      </div>
    </div>
  );
}

function chartDomain(entry: QuantStockForwardEntry, valuation: QuantStockForwardValuation): [number, number] {
  const values = entry.series.map((point) => point.value).filter(Number.isFinite);
  const floor = Math.min(...values, valuation.thresholds.full_position_max, 20);
  const ceiling = Math.max(...values, valuation.thresholds.high_max, 34);
  return [Math.max(0, Math.floor(floor - 2)), Math.ceil(ceiling + 2)];
}

function formatNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '暂无';
}

function isAvailableEntry(
  entry: QuantStockForwardEntry | undefined,
): entry is QuantStockForwardEntry & { current: number; zone: QuantStockForwardZone } {
  return Boolean(entry?.available && entry.current !== null && entry.zone);
}

function isAvailableIndexEntry(
  entry: QuantForwardPeEntry | undefined,
): entry is QuantForwardPeEntry & { current: number } {
  return Boolean(entry && entry.current !== null && entry.series.length > 0);
}

function axisTick() {
  return { fill: 'var(--color-ink-muted)', fontSize: 11, fontFamily: 'SF Mono, monospace' };
}
