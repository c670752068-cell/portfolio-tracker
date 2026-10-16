import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { FormEvent, ReactElement } from 'react';
import {
  Area, Bar, BarChart, Brush, CartesianGrid, Cell, ComposedChart, Line, LineChart, ReferenceDot, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { getServerChannelAlertsUrl, getServerMaSlopeUrl } from '../runtimeConfig';
import {
  fetchChannelReview, fetchMaSlopeDashboard, normalizeMaSlopeSymbol, type MaSlopeDashboardResult,
} from '../maSlopeQuery';
import type {
  Holding, QuantAnalysisSnapshot, QuantChannelAlert, QuantChannelReviewSnapshot,
  QuantMaSlopeDashboardPoint, QuantMaSlopeDashboardRange, QuantMaSlopeTechnicalSummary,
  ZBreakoutEvent,
} from '../types';
import { createChartDateStore, createChartScrollGroup, tradingDateIndex } from '../chartDateSync';
import { CHANNEL_FILTERS, heldTechnicalSymbols, matchesChannelFilter, technicalPresetSymbols, technicalSymbolName, type ChannelFilter } from '../technicalSymbols';
import { zBarColor } from '../decisionSignals';
import { breakoutDescription } from '../breakoutSignals';

interface Props {
  snapshot: QuantAnalysisSnapshot; holdings?: readonly Holding[];
  selectedSymbol?: string; onSelectedSymbolChange?: (symbol: string) => void;
  onDashboard?: (result: MaSlopeDashboardResult) => void;
  compact?: boolean; displayMode?: 'closed' | 'preview';
  onDisplayModeChange?: (mode: 'closed' | 'preview') => void;
  breakoutEvents?: ZBreakoutEvent[];
}

const EMPTY_HOLDINGS: readonly Holding[] = [];
const ChartLinkContext = createContext<{
  scroll: ReturnType<typeof createChartScrollGroup>;
  date: ReturnType<typeof createChartDateStore>;
  syncId: string;
  enabled: boolean;
} | null>(null);
const RANGE_OPTIONS: Array<{ value: QuantMaSlopeDashboardRange; label: string }> = [
  { value: '1y', label: '1年' }, { value: '3y', label: '3年' },
  { value: '5y', label: '5年' }, { value: '10y', label: '10年' },
  { value: '20y', label: '20年' },
];
const MA_LINES = [
  { period: 20, maKey: 'ma20', slopeKey: 'slope20', color: '#1f77b4' },
  { period: 50, maKey: 'ma50', slopeKey: 'slope50', color: '#ff7f0e' },
  { period: 200, maKey: 'ma200', slopeKey: 'slope200', color: '#7c3aed' },
] as const;
const TOOLTIP_STYLE = {
  background: 'var(--color-surface-raised)',
  border: '1px solid color-mix(in srgb, var(--color-neutral) 55%, transparent)',
  borderRadius: 12, color: 'var(--color-ink-primary)', fontSize: 12,
} as const;

export function MaSlopeExplorer({ snapshot, holdings = EMPTY_HOLDINGS, selectedSymbol, onSelectedSymbolChange, onDashboard, compact = false, displayMode = 'preview', onDisplayModeChange, breakoutEvents }: Props) {
  const symbols = useMemo(() => technicalPresetSymbols(snapshot, holdings), [snapshot, holdings]);
  const held = useMemo(() => heldTechnicalSymbols(holdings), [holdings]);
  const [filter, setFilter] = useState<ChannelFilter>('all');
  const initial = symbols.includes('NVDA') ? 'NVDA' : symbols[0] ?? 'NDX';
  const [internalSelected, setSelected] = useState(initial);
  const selected = selectedSymbol ?? internalSelected;
  const [input, setInput] = useState(initial);
  const [range, setRange] = useState<QuantMaSlopeDashboardRange>('5y');
  const [slopeWindow, setSlopeWindow] = useState(8);
  const [showVolume, setShowVolume] = useState(true);
  const [logScale, setLogScale] = useState(false);
  const [linked, setLinked] = useState(true);
  const [result, setResult] = useState<MaSlopeDashboardResult | null>(
    () => dashboardResultFromSnapshot(snapshot, initial),
  );
  const [channelReview, setChannelReview] = useState<QuantChannelReviewSnapshot>(
    () => channelReviewFromSnapshot(snapshot, initial),
  );
  const [refreshToken, setRefreshToken] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const forceRefresh = useRef(false);
  const visibleSymbols = symbols.filter((symbol) => matchesChannelFilter(symbol, filter, held, channelReview.symbols[symbol]));

  const refreshChart = () => {
    forceRefresh.current = true;
    setRefreshToken((current) => current + 1);
  };

  useEffect(() => {
    const timer = window.setInterval(refreshChart, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (compact) return undefined;
    const endpoint = getServerChannelAlertsUrl();
    if (!endpoint) return undefined;
    const controller = new AbortController();
    void fetchChannelReview(endpoint, controller.signal)
      .then((review) => setChannelReview(review))
      .catch(() => undefined);
    return () => controller.abort();
  }, [snapshot.generated_at, compact]);

  useEffect(() => {
    const bypassCache = forceRefresh.current;
    forceRefresh.current = false;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const endpoint = getServerMaSlopeUrl() || '/api/portfolio/ma-slope';
        const next = await fetchMaSlopeDashboard(endpoint, selected, {
          range, slopeWindow, refresh: bypassCache, signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setResult(next);
          onDashboard?.(next);
          const alert = next.dashboard.channel_alert;
          if (alert) {
            setChannelReview((current) => ({
              ...current,
              symbols: { ...current.symbols, [selected]: alert },
            }));
          }
        }
      } catch (caught) {
        if (controller.signal.aborted) return;
        setResult(null);
        setError(caught instanceof Error ? caught.message : 'K 线斜率查询失败');
      } finally {
        if (request.current === controller) setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [range, refreshToken, selected, slopeWindow, onDashboard, snapshot.generated_at]);

  const showSymbol = (rawSymbol: string) => {
    try {
      const symbol = normalizeMaSlopeSymbol(rawSymbol);
      setInput(symbol);
      setSelected(symbol);
      onSelectedSymbolChange?.(symbol);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '股票代码格式不正确');
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    showSymbol(input);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-neutral/40 bg-surface-raised" data-testid="ma-slope-explorer">
      <header className="border-b border-neutral/30 p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            {!compact && <div className="text-[10px] font-bold tracking-[0.2em] text-buy sm:text-xs">MA + SLOPE</div>}
            <h2 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">股票与指数斜率曲线</h2>
            {!compact && <p className="mt-1 text-xs text-ink-muted sm:text-sm">原版 K 线趋势图：股价 + 20/50/200 日均线 + 对应斜率曲线</p>}
          </div>
          <form onSubmit={submit} className="flex w-full gap-2 lg:w-auto" role="search">
            {compact ? <select aria-label="技术图表标的" value={selected} onChange={(event) => showSymbol(event.target.value)} className="min-h-11 w-full rounded-lg border border-buy/50 bg-surface-raised px-3 text-sm font-semibold text-buy lg:max-w-64">{[...new Set([...symbols, selected])].map((symbol) => <option key={symbol} value={symbol}>{symbol} · {technicalSymbolName(symbol, holdings, snapshot.growth_watchlist?.names)}</option>)}</select> : <>
            <input
              aria-label="输入股票代码" value={input}
              onChange={(event) => setInput(event.target.value.toUpperCase())}
              placeholder="输入股票代码，如 AMD" autoCapitalize="characters"
              autoComplete="off" spellCheck={false}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-neutral/45 bg-surface-overlay px-3 text-sm font-semibold uppercase text-ink-primary outline-none transition focus:border-buy focus:ring-2 focus:ring-buy/20 motion-reduce:transition-none lg:w-56"
            />
            <button
              type="submit" disabled={loading}
              className="min-h-11 shrink-0 rounded-xl bg-buy px-4 text-sm font-bold text-white shadow-sm transition active:scale-[.98] disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none"
            >{loading ? '加载中…' : '查询曲线'}</button>
            </>}
          </form>
        </div>
        {!compact && <><div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-semibold text-ink-muted sm:text-xs">
          <span>每天美东 {channelReview.review_time || '16:20'} 按最新完整收盘统一审查{channelReview.review_date ? ` · 最近 ${channelReview.review_date}` : ''}</span>
          <span className="flex flex-wrap gap-2" aria-label="通道提醒颜色说明">
            <i className="rounded bg-emerald-600 px-2 py-1 not-italic text-white">绿色＝买入区</i>
            <i className="rounded bg-red-600 px-2 py-1 not-italic text-white">红色＝卖出区</i>
            <i className="rounded bg-surface-overlay px-2 py-1 not-italic">灰色＝通道内</i>
          </span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="通道提醒筛选">
          {CHANNEL_FILTERS.map((option) => (
            <button key={option.value} type="button" aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={`min-h-11 rounded-xl border px-3 text-sm font-semibold transition active:scale-[.98] motion-reduce:transition-none ${filter === option.value ? 'border-buy bg-buy text-white' : 'border-neutral/40 bg-surface-overlay text-ink-secondary'}`}>
              {option.label}<span className="ml-1.5 tabular-nums opacity-75">{symbols.filter((symbol) => matchesChannelFilter(symbol, option.value, held, channelReview.symbols[symbol])).length}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-muted">筛选依据通道提醒，不是正式回撤决策；未完成审查的标的不归入买卖区。</p>
        <div className="mt-3 grid max-h-64 grid-cols-3 gap-2 overflow-y-auto p-1 sm:grid-cols-6 lg:grid-cols-8" data-testid="technical-symbol-list">
          {visibleSymbols.map((symbol) => (
            <button
              key={symbol} type="button" aria-pressed={symbol === selected}
              onClick={() => showSymbol(symbol)}
              data-channel-state={channelReview.symbols[symbol]?.state ?? 'unreviewed'}
              className={symbolButtonClass(channelReview.symbols[symbol], symbol === selected)}
            >
              <strong className="block text-sm">{symbol}</strong>
              <span className="mt-0.5 block text-xs leading-snug opacity-85">{technicalSymbolName(symbol, holdings, snapshot.growth_watchlist?.names)}</span>
              {held.has(symbol) && <span className="mt-1 block text-xs opacity-80">已持仓</span>}
              {channelReview.symbols[symbol]?.available && channelReview.symbols[symbol].state !== 'neutral' && (
                <span className="mt-1 block text-xs font-bold">{channelReview.symbols[symbol].label}</span>
              )}
            </button>
          ))}
        </div>
        {visibleSymbols.length === 0 && <p role="status" className="mt-3 rounded-xl bg-surface-overlay p-4 text-sm text-ink-muted">当前没有符合“{CHANNEL_FILTERS.find((option) => option.value === filter)?.label}”的标的。可切换“全部”或直接输入股票代码查询。</p>}
        <p className="mt-2 text-xs text-ink-muted">正在查看：{selected} · {technicalSymbolName(selected, holdings, snapshot.growth_watchlist?.names)}{!visibleSymbols.includes(selected) ? '（不在当前筛选结果内）' : ''}</p></>}
        <ChartControls
          range={range} slopeWindow={slopeWindow} showVolume={showVolume} logScale={logScale}
          onRange={setRange} onSlopeWindow={setSlopeWindow}
          onShowVolume={setShowVolume} onLogScale={setLogScale}
          onRefresh={refreshChart} loading={loading}
          compact={compact} linked={linked} onLinked={setLinked}
        />
        {compact && <div className="decision-mode"><button type="button" aria-pressed={displayMode === 'closed'} onClick={() => onDisplayModeChange?.('closed')}>完整收盘 · {result?.symbol === selected ? result.dashboard.latest_closed_as_of ?? '待更新' : '加载中'}</button><button type="button" aria-pressed={displayMode === 'preview'} onClick={() => onDisplayModeChange?.('preview')}>盘中预览 · 未收盘确认</button></div>}
      </header>
      <div className="p-4 sm:p-5" aria-live="polite" aria-busy={loading}>
        {error ? <ErrorState message={error} /> : result && result.symbol === selected && result.dashboard.range === range && result.dashboard.slope_window_sessions === slopeWindow ? (
          <SlopeDashboard key={`${result.symbol}:${result.dashboard.range}:${displayMode}`} result={result} showVolume={showVolume} logScale={logScale} compact={compact} displayMode={displayMode} linked={linked} breakoutEvents={breakoutEvents?.filter(event => event.symbol === result.symbol)} />
        ) : <LoadingState />}
      </div>
    </section>
  );
}

function ChartControls({
  range, slopeWindow, showVolume, logScale,
  onRange, onSlopeWindow, onShowVolume, onLogScale, onRefresh, loading, compact, linked, onLinked,
}: {
  range: QuantMaSlopeDashboardRange; slopeWindow: number;
  showVolume: boolean; logScale: boolean; loading: boolean;
  onRange: (value: QuantMaSlopeDashboardRange) => void;
  onSlopeWindow: (value: number) => void;
  onShowVolume: (value: boolean) => void;
  onLogScale: (value: boolean) => void;
  onRefresh: () => void;
  compact?: boolean; linked: boolean; onLinked: (value: boolean) => void;
}) {
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl bg-surface-overlay p-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap gap-1" aria-label="图表周期">
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option.value} type="button" aria-pressed={range === option.value}
            onClick={() => onRange(option.value)}
            className={`min-h-9 rounded-lg px-3 text-xs font-semibold ${range === option.value ? 'bg-buy text-white' : 'bg-surface-raised text-ink-muted'}`}
          >{option.label}</button>
        ))}
      </div>
      <details className={compact ? 'relative' : 'contents'} open={compact ? undefined : true}>
      {compact && <summary className="cursor-pointer rounded-lg border border-neutral/40 px-3 py-2 text-xs font-semibold">图表设置 · 回看 {slopeWindow} 日</summary>}
      <div className={compact ? 'absolute right-0 z-20 mt-2 w-72 max-w-[80vw] space-y-4 rounded-xl border border-neutral/50 bg-surface-raised p-4 shadow-lg' : 'flex flex-wrap items-center gap-4'}>
      <label className="flex min-w-0 items-center gap-2 text-xs text-ink-secondary">
        <span className="shrink-0">斜率回看 {slopeWindow} 日</span>
        <input
          aria-label="斜率回看交易日" type="range" min="1" max="30"
          value={slopeWindow} onChange={(event) => onSlopeWindow(Number(event.target.value))}
          className="min-w-28 accent-buy"
        />
      </label>
      <div className="flex flex-wrap gap-4 text-xs text-ink-secondary">
        <Toggle label="显示成交量" checked={showVolume} onChange={onShowVolume} />
        <Toggle label="对数价格轴" checked={logScale} onChange={onLogScale} />
        <Toggle label="四图日期指示线联动" checked={linked} onChange={onLinked} />
      </div>
      {compact && <p className="text-xs leading-relaxed text-ink-muted">本图：{slopeWindow} 日回看 · %/天。判断详情：20 日回看 · 252 日年化。两种口径分别标注，仅影响显示。</p>}
      </div></details>
        <button
          type="button" onClick={onRefresh} disabled={loading}
          className="min-h-9 rounded-lg border border-neutral/45 bg-surface-raised px-3 font-semibold text-ink-primary disabled:cursor-wait disabled:opacity-60"
        >{loading ? '刷新中…' : '刷新最新'}</button>
    </div>
  );
}

function Toggle({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-9 items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-4 accent-buy" />
      {label}
    </label>
  );
}

function SlopeDashboard({ result, showVolume, logScale, compact, displayMode, linked, breakoutEvents }: {
  result: MaSlopeDashboardResult; showVolume: boolean; logScale: boolean;
  compact: boolean; displayMode: 'closed' | 'preview'; linked: boolean;
  breakoutEvents?: ZBreakoutEvent[];
}) {
  const [scroll] = useState(createChartScrollGroup);
  const [date] = useState(createChartDateStore);
  const syncId = useId();
  const link = useMemo(() => ({ scroll, date, syncId, enabled: linked }), [scroll, date, syncId, linked]);
  const [windowRange, setWindowRange] = useState<{ start: number; end?: number }>({ start: 0 });
  const allPoints = displayMode === 'closed' ? result.dashboard.series.filter((point) => !point.is_partial) : result.dashboard.series;
  const points = allPoints.slice(Math.min(windowRange.start, Math.max(0, allPoints.length - 2)), windowRange.end == null ? undefined : windowRange.end + 1);
  const latest = points.at(-1);
  if (!latest) return <ErrorState message={result.reason} />;
  const summary = result.dashboard.summary ?? summaryFromLatest(latest);
  const status = latest.is_partial ? 'intraday' : 'closed';
  const latestLabel = `${latest.date}${status === 'intraday' ? '（盘中）' : '（完整收盘）'}`;
  const endpointLabel = latest.date === allPoints.at(-1)?.date ? '最新' : '区间末日';
  const latestClosed = result.dashboard.latest_closed_as_of
    ?? (latest.is_partial ? points.findLast((point) => !point.is_partial)?.date : latest.date)
    ?? '暂无';
  return (
    <ChartLinkContext.Provider value={link}>
      {!compact && <TechnicalSummary summary={summary} symbol={result.symbol} asOf={latestLabel} />}
      <p className="mt-3 rounded-xl border border-buy/25 bg-buy/5 px-3 py-2 text-xs font-semibold text-ink-secondary" data-testid="latest-data-status">
        {endpointLabel} {latestLabel} · 最新完整收盘 {latestClosed}
      </p>
      {compact && displayMode === 'preview' && !allPoints.at(-1)?.is_partial && <p className="mt-2 text-xs text-ink-muted">暂无盘中日线，当前图表仍为完整收盘，不作盘中信号。</p>}
      {!compact && result.dashboard.channel_alert && <ChannelAlertCard alert={result.dashboard.channel_alert} symbol={result.symbol} />}
      <LinkedDateControls points={points} onLatest={() => setWindowRange({ start: 0 })} />
      <ChartHeader title="股价与移动均线 + ±1.5σ 通道（200DMA）" note={`${result.dashboard.range.toUpperCase()} · ${endpointLabel} ${latestLabel}`} />
      <ChartLegend includeClose includeBand />
      <PriceMaChart points={points} symbol={result.symbol} logScale={logScale} />
      <section className="min-w-0" data-testid="z-score-section">
        <ChartHeader
          title="标准差动能图（Z-Score vs 200DMA）"
          note="正值=高于200DMA · 负值=低于200DMA，并非当天涨跌"
        />
        <p className="mb-2 text-xs font-semibold tabular-nums text-ink-secondary">
          {endpointLabel} {latestLabel} · Z-Score {nullableIndicator(latest.zscore200)}
        </p>
        <ZScoreChart points={points} breakoutEvents={breakoutEvents} />
        <p className="text-xs text-ink-muted">红色 Z ≥ +1.50：卖出区 · 绿色 Z ≤ −1.50：买入区。通道突破与 Z-Score ±1.5 为同一条件。</p>
      </section>
      <section className="min-w-0" data-testid="slope-section">
        <ChartHeader
          title={`SMA 斜率曲线（%/天，${result.dashboard.slope_window_sessions}日回看）`}
          note="三条均线的变化速度"
        />
        <ChartLegend />
        <LatestIndicatorStrip point={latest} latestLabel={latestLabel} prefix={endpointLabel} />
        <SlopeLineChart points={points} />
        <p className="text-xs text-ink-muted">本图：{result.dashboard.slope_window_sessions} 日回看 · %/天；主表 SMA 固定8日回看；年化趋势栏为20日回看 · 252日年化，口径不同。</p>
      </section>
      {showVolume && <section className="min-w-0" data-testid="volume-section"><ChartHeader title="成交量" note={`${endpointLabel} ${latest.volume == null ? '—' : compactNumber(latest.volume)}`} /><VolumeChart points={points} /></section>}
      <div className="mt-4" data-testid="technical-range-brush" aria-label="四图时间范围">
        <ResponsiveContainer width="100%" height={60} initialDimension={{ width: 900, height: 60 }}><LineChart data={allPoints}><Brush dataKey="date" height={28} startIndex={windowRange.start} endIndex={windowRange.end ?? allPoints.length - 1} tickFormatter={axisDate} stroke="#8b5cf6" fill="var(--color-surface-overlay)" onChange={(next) => { if (next.startIndex != null && next.endIndex != null && next.endIndex > next.startIndex) { setWindowRange({ start: next.startIndex, end: next.endIndex === allPoints.length - 1 ? undefined : next.endIndex }); date.setDate(null); } }}><LineChart><Line dataKey="close" stroke="#8b5cf6" dot={false} isAnimationActive={false} /></LineChart></Brush></LineChart></ResponsiveContainer>
      </div>
      <p className="mt-4 rounded-xl border border-neutral/35 bg-surface-overlay px-3 py-2 text-[10px] leading-relaxed text-ink-muted sm:text-xs">
        数据：{result.data_source}。标准差动能柱不是成交量；它表示价格相对 200DMA 偏离了多少个滚动标准差。整套技术图<strong className="text-ink-primary">不进入买入裁决</strong>；正式买入仍只按回撤深度判断。
      </p>
    </ChartLinkContext.Provider>
  );
}

function ChannelAlertCard({ alert, symbol }: { alert: QuantChannelAlert; symbol: string }) {
  const tone = alert.state === 'buy' || alert.state === 'buy_near'
    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : alert.state === 'sell' || alert.state === 'sell_near'
      ? 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300'
      : 'border-neutral/35 bg-surface-overlay text-ink-secondary';
  return (
    <div className={`mt-3 rounded-xl border px-3 py-3 ${tone}`} data-testid="channel-alert-card" data-channel-state={alert.state}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{symbol} · 通道提醒：{alert.label}</strong>
        <span className="text-xs tabular-nums">完整收盘 {alert.as_of ?? '—'} · Z {alert.z_score == null ? '—' : signed(alert.z_score, 2)}</span>
      </div>
      <p className="mt-1 text-xs font-semibold">{alert.reason}</p>
      {alert.close != null && alert.lower_band != null && alert.upper_band != null && (
        <p className="mt-1 text-[10px] tabular-nums opacity-80 sm:text-xs">
          收盘 {moneyText(alert.close)} · 下轨 {moneyText(alert.lower_band)} · 上轨 {moneyText(alert.upper_band)}
        </p>
      )}
      <p className="mt-1 text-[10px] opacity-75 sm:text-xs">独立颜色提醒，不自动下单，也不覆盖正式回撤买入裁决。</p>
    </div>
  );
}

function PriceMaChart({ points, symbol, logScale }: {
  points: QuantMaSlopeDashboardPoint[]; symbol: string; logScale: boolean;
}) {
  const latest = points.at(-1);
  const events = useLinkedDateEvents();
  const chartPoints = logScale ? points.map((point) => point.band200 && point.band200[0] <= 0 ? { ...point, band200: null } : point) : points;
  return (
    <ChartShell height={390} testId="price-chart" latestDate={latest?.date}>
      <ComposedChart data={chartPoints} {...events} margin={{ top: 12, right: 56, bottom: 8, left: 2 }}>
        <CartesianGrid stroke="var(--color-neutral)" strokeOpacity={0.18} vertical={false} />
        <XAxis dataKey="date" scale="point" tickFormatter={axisDate} minTickGap={44} tick={axisTick()} interval="preserveStartEnd" padding={{ left: 8, right: 28 }} tickMargin={8} />
        <YAxis width={58} tick={axisTick()} domain={['auto', 'auto']} scale={logScale ? 'log' : 'auto'} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={priceTooltip} labelFormatter={(value) => `日期 ${value}`} />
        <Area type="linear" dataKey="band200" name="±1.5σ 通道" stroke="none" fill="#8b5cf6" fillOpacity={0.12} isAnimationActive={false} />
        <Line type="linear" dataKey="close" name={`${symbol} 收盘价`} stroke="var(--color-ink-primary)" strokeWidth={1.7} dot={false} isAnimationActive={false} />
        {MA_LINES.map((line) => (
          <Line key={line.period} type="linear" dataKey={line.maKey} name={`${line.period}DMA`} stroke={line.color} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
        ))}
        {latest && <LatestDateLine point={latest} />}
        {latest && <ReferenceDot x={latest.date} y={latest.close} r={3.5} fill="var(--color-ink-primary)" stroke="var(--color-surface-raised)" />}
      </ComposedChart>
    </ChartShell>
  );
}

function ZScoreChart({ points, breakoutEvents = [] }: { points: QuantMaSlopeDashboardPoint[]; breakoutEvents?: ZBreakoutEvent[] }) {
  const latest = points.at(-1);
  const events = useLinkedDateEvents();
  const [focused, setFocused] = useState<ZBreakoutEvent | null>(null);
  const markers = breakoutEvents.filter(e => points.some(p => p.date === e.date && !p.is_partial));
  return (
    <>
    <ChartShell height={320} testId="z-score-chart" latestDate={latest?.date}>
      <BarChart data={points} {...events} margin={{ top: 12, right: 56, bottom: 8, left: 2 }}>
        <CartesianGrid stroke="var(--color-neutral)" strokeOpacity={0.18} vertical={false} />
        <XAxis dataKey="date" scale="point" tickFormatter={axisDate} minTickGap={44} tick={axisTick()} interval="preserveStartEnd" padding={{ left: 8, right: 28 }} tickMargin={8} />
        <YAxis width={58} tick={axisTick()} domain={['auto', 'auto']} tickFormatter={(value) => Number(value).toFixed(1)} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [Number(value).toFixed(3), 'Z-Score']} labelFormatter={(value) => `日期 ${value}`} />
        <ReferenceLine y={0} stroke="var(--color-ink-muted)" />
        <ReferenceLine y={1.5} stroke="#dc2626" strokeDasharray="5 5" label={{ value: '卖出 +1.5', fill: '#dc2626', fontSize: 11, position: 'insideTopRight' }} />
        <ReferenceLine y={-1.5} stroke="#059669" strokeDasharray="5 5" label={{ value: '买入 −1.5', fill: '#059669', fontSize: 11, position: 'insideBottomRight' }} />
        <Bar dataKey="zscore200" name="Z-Score" isAnimationActive={false}>
          {points.map((point) => (
            <Cell key={point.date} fill={zBarColor(point.zscore200)} />
          ))}
        </Bar>
        {latest && <LatestDateLine point={latest} />}
        {latest?.zscore200 != null && <ReferenceDot x={latest.date} y={latest.zscore200} r={3.5} fill={zBarColor(latest.zscore200)} stroke="var(--color-surface-raised)" />}
        {markers.map(event => <ReferenceDot key={event.id} x={event.date} y={event.z} ifOverflow="extendDomain" shape={props => <g transform={`translate(${props.cx},${props.cy})`} role="button" tabIndex={0} aria-label={breakoutDescription(event)} onClick={() => setFocused(event)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFocused(event); } }} style={{ cursor: 'pointer' }} data-breakout-marker={event.id}><title>{breakoutDescription(event)}</title><circle r={12} fill="var(--color-surface-raised)" stroke="var(--color-buy)" strokeWidth={1.5} /><text textAnchor="middle" dy=".35em" fill="var(--color-buy)" fontSize={15}>{event.direction === 'up' ? '↑' : '↓'}</text></g>} />)}
      </BarChart>
    </ChartShell>
    {markers.length > 0 && <p className="decision-note">紫色箭头为已收盘确认的露头；点击或键盘选中标记查看，不代表买卖建议。</p>}
    {focused && <p className="decision-new-notice" role="status">{breakoutDescription(focused)} <button type="button" aria-label="关闭露头标记详情" onClick={() => setFocused(null)}>×</button></p>}
    </>
  );
}

function SlopeLineChart({ points }: { points: QuantMaSlopeDashboardPoint[] }) {
  const latest = points.at(-1);
  const events = useLinkedDateEvents();
  return (
    <ChartShell height={320} testId="slope-chart" latestDate={latest?.date}>
      <LineChart data={points} {...events} margin={{ top: 12, right: 56, bottom: 8, left: 2 }}>
        <CartesianGrid stroke="var(--color-neutral)" strokeOpacity={0.18} vertical={false} />
        <XAxis dataKey="date" scale="point" tickFormatter={axisDate} minTickGap={44} tick={axisTick()} interval="preserveStartEnd" padding={{ left: 8, right: 28 }} tickMargin={8} />
        <YAxis width={58} tick={axisTick()} domain={['auto', 'auto']} tickFormatter={(value) => `${Number(value).toFixed(2)}%`} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [`${Number(value).toFixed(3)}%/天`, name]} labelFormatter={(value) => `日期 ${value}`} />
        <ReferenceLine y={0} stroke="var(--color-ink-muted)" strokeDasharray="5 5" />
        {MA_LINES.map((line) => (
          <Line key={line.period} type="linear" dataKey={line.slopeKey} name={`${line.period}DMA slope`} stroke={line.color} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
        ))}
        {latest && <LatestDateLine point={latest} />}
        {latest && MA_LINES.map((line) => {
          const value = latest[line.slopeKey];
          return value == null ? null : (
            <ReferenceDot key={line.period} x={latest.date} y={value} r={3.5} fill={line.color} stroke="var(--color-surface-raised)" />
          );
        })}
      </LineChart>
    </ChartShell>
  );
}

function VolumeChart({ points }: { points: QuantMaSlopeDashboardPoint[] }) {
  const latest = points.at(-1);
  const events = useLinkedDateEvents();
  return (
    <ChartShell height={150} testId="volume-chart" latestDate={latest?.date}>
      <BarChart data={points} {...events} margin={{ top: 8, right: 56, bottom: 8, left: 2 }}>
        <XAxis dataKey="date" scale="point" tickFormatter={axisDate} minTickGap={44} tick={axisTick()} interval="preserveStartEnd" padding={{ left: 8, right: 28 }} tickMargin={8} />
        <YAxis width={58} tick={axisTick()} tickFormatter={compactNumber} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [compactNumber(Number(value)), '成交量']} labelFormatter={(value) => `日期 ${value}`} />
        <Bar dataKey="volume" fill="var(--color-neutral)" opacity={0.65} isAnimationActive={false} />
        {latest && <LatestDateLine point={latest} />}
      </BarChart>
    </ChartShell>
  );
}

function ChartShell({ height, children, minWidth = 700, testId, latestDate }: {
  height: number; children: ReactElement; minWidth?: number; testId?: string; latestDate?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const { scroll } = useChartLink();
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const unregister = scroll.register(element);
    let frame = 0;
    const resize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(scroll.align);
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(element);
    if (element.firstElementChild) observer?.observe(element.firstElementChild);
    window.addEventListener('resize', resize);
    resize();
    return () => { unregister(); observer?.disconnect(); window.removeEventListener('resize', resize); window.cancelAnimationFrame(frame); };
  }, [scroll, latestDate, minWidth]);
  return (
    <div ref={scroller} onScroll={(event) => scroll.scroll(event.currentTarget)} className="overflow-x-auto overscroll-x-contain" data-testid={testId} data-linked-chart="true" data-align-latest={latestDate ? 'true' : undefined}>
      <div style={{ minWidth }}>
        <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 900, height }}>
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ChartHeader({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-2 mt-6 flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-sm font-bold sm:text-base">{title}</h3>
      <span className="text-[10px] text-ink-muted sm:text-xs">{note}</span>
    </div>
  );
}

function useChartLink() {
  const link = useContext(ChartLinkContext);
  if (!link) throw new Error('Linked charts require a shared date context');
  return link;
}

function useLinkedDateEvents() {
  const { date, syncId, enabled } = useChartLink();
  const select = useCallback((state: { activeLabel?: string | number }) => {
    if (enabled && typeof state.activeLabel === 'string') date.setDate(state.activeLabel);
  }, [date, enabled]);
  return { syncId: enabled ? syncId : undefined, syncMethod: 'value' as const, onMouseMove: select, onClick: select, onTouchStart: select, onTouchMove: select };
}

function LinkedDateControls({ points, onLatest }: { points: QuantMaSlopeDashboardPoint[]; onLatest: () => void }) {
  const { date, scroll } = useChartLink();
  const selected = useSyncExternalStore(date.subscribe, date.getSnapshot, date.getSnapshot);
  const dates = useMemo(() => points.map((point) => point.date), [points]);
  const point = points[tradingDateIndex(dates, selected ?? dates.at(-1) ?? '')];
  if (!point) return null;
  return (
    <div className="mt-4 rounded-xl border border-buy/30 bg-buy/5 p-3" data-testid="linked-date-controls">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
          联动日期
          <input type="date" aria-label="联动日期" min={dates[0]} max={dates.at(-1)} value={point.date}
            onChange={(event) => {
              if (!event.target.value) return;
              const index = tradingDateIndex(dates, event.target.value);
              date.setDate(dates[index]);
              scroll.reveal(index, dates.length);
            }} className="min-h-11 min-w-0 rounded-lg border border-neutral/40 bg-surface-raised px-2 text-sm text-ink-primary" />
        </label>
        <button type="button" onClick={() => { onLatest(); date.setDate(null); scroll.latest(); }}
          className="min-h-11 rounded-lg bg-buy px-3 text-sm font-semibold text-white transition active:scale-[.98] motion-reduce:transition-none">回到最新</button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs tabular-nums text-ink-secondary sm:grid-cols-4" data-testid="linked-date-values">
        <span>{point.date} · {point.is_partial ? '盘中未收盘' : '完整收盘'}</span>
        <span>{point.is_partial ? '最新价' : '收盘价'} {moneyText(point.close)}</span>
        <span>Z-Score {nullableIndicator(point.zscore200)}</span>
        <span>成交量 {point.volume == null ? '—' : compactNumber(point.volume)}</span>
        {MA_LINES.map((line) => <span key={line.period}>{line.period}DMA 斜率 {nullableSlope(point[line.slopeKey])}</span>)}
      </div>
      <p className="mt-2 text-xs text-ink-muted">悬停或轻点任一图，四图对齐同一日期；左右滑动同步。非交易日显示前一个可用交易日。</p>
    </div>
  );
}

function LatestIndicatorStrip({ point, latestLabel, prefix = '最新' }: {
  point: QuantMaSlopeDashboardPoint; latestLabel: string; prefix?: string;
}) {
  return (
    <div className="mb-2 grid grid-cols-2 gap-1 rounded-xl border border-neutral/30 bg-surface-overlay p-2 text-[10px] font-semibold tabular-nums text-ink-secondary sm:grid-cols-4 sm:text-xs" data-testid="latest-slope-values">
      <span>{prefix} {latestLabel}</span>
      <span>20DMA {nullableSlope(point.slope20)}</span>
      <span>50DMA {nullableSlope(point.slope50)}</span>
      <span>200DMA {nullableSlope(point.slope200)}</span>
    </div>
  );
}

function LatestDateLine({ point }: { point: QuantMaSlopeDashboardPoint }) {
  const { date } = useChartLink();
  const selected = useSyncExternalStore(date.subscribe, date.getSnapshot, date.getSnapshot);
  return (
    <ReferenceLine
      x={selected ?? point.date} stroke="var(--color-buy)" strokeDasharray="3 3"
      label={{ value: selected ?? point.date, position: 'insideTopRight', fill: 'var(--color-ink-muted)', fontSize: 11 }}
    />
  );
}

function ChartLegend({ includeClose = false, includeBand = false }: { includeClose?: boolean; includeBand?: boolean }) {
  return (
    <div className="mb-2 flex flex-wrap gap-3 text-[10px] text-ink-muted sm:text-xs">
      {includeClose && <LegendLine color="var(--color-ink-primary)" label="收盘价" />}
      {MA_LINES.map((line) => <LegendLine key={line.period} color={line.color} label={`${line.period}DMA`} />)}
      {includeBand && <LegendBand label="±1.5σ 通道" />}
    </div>
  );
}

function LegendBand({ label }: { label: string }) {
  return <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-4 rounded-sm bg-violet-500/20" />{label}</span>;
}

function LegendLine({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4" style={{ backgroundColor: color }} />{label}</span>;
}

function TechnicalSummary({ summary, symbol, asOf }: {
  summary: QuantMaSlopeTechnicalSummary; symbol: string; asOf: string;
}) {
  const rows = [
    { label: '价格', value: moneyText(summary.price), detail: `${symbol} · ${asOf}` },
    { label: '200 DMA / 距离', value: nullableMoney(summary.ma200), detail: nullablePercent(summary.distance_to_ma200_pct, 2) },
    { label: 'Z-Score / 状态', value: nullableSigned(summary.z_score, 2), detail: summary.z_score_label },
    { label: '200 DMA 年化斜率 / 趋势', value: nullablePercent(summary.ma200_slope_annualized_pct, 2), detail: summary.ma200_trend_label },
    { label: 'Z-Score 区间', value: summary.z_score_band ?? '—', detail: '每 0.5σ 一档' },
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-neutral/35 bg-surface-overlay" aria-label="技术面摘要">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-neutral/25 px-3 py-2.5 last:border-b-0 sm:px-4">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted sm:text-xs">{row.label}</span>
          <span className="text-right text-xs font-bold tabular-nums text-ink-primary sm:text-sm">{row.value}<small className="ml-2 font-medium text-ink-muted">{row.detail}</small></span>
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return <div className="rounded-xl border border-loss/40 bg-loss/8 px-4 py-6 text-sm text-loss">{message}。请检查代码后重试。</div>;
}

function LoadingState() {
  return <div className="rounded-xl bg-surface-overlay px-4 py-10 text-center text-sm text-ink-muted">正在读取 K 线、移动均线和斜率曲线…</div>;
}

function dashboardResultFromSnapshot(snapshot: QuantAnalysisSnapshot, symbol: string): MaSlopeDashboardResult | null {
  const slope = snapshot.symbols?.[symbol]?.ma_slope;
  if (!slope?.dashboard) return null;
  return {
    symbol, available: true, decision_use: false, buy_veto: false,
    query_source: 'custom_dashboard', data_source: slope.data_source,
    price_adjustment: slope.price_adjustment, as_of: slope.as_of,
    required_bars: slope.required_bars ?? 205,
    observed_bars: slope.observed_bars ?? slope.dashboard.series.length,
    reason: slope.reason, dashboard: slope.dashboard,
  };
}

function channelReviewFromSnapshot(snapshot: QuantAnalysisSnapshot, symbol: string): QuantChannelReviewSnapshot {
  const alert = snapshot.symbols?.[symbol]?.ma_slope?.dashboard?.channel_alert;
  return {
    review_time: '16:20', timezone: 'America/New_York', review_date: null,
    updated_at: null, symbols: alert ? { [symbol]: alert } : {},
  };
}

function symbolButtonClass(alert: QuantChannelAlert | undefined, selected: boolean): string {
  const base = 'min-h-14 rounded-xl px-2 py-2 text-left transition active:scale-[.98] motion-reduce:transition-none';
  const ring = selected ? ' ring-2 ring-violet-400 ring-offset-2 ring-offset-surface-raised' : '';
  if (alert?.state === 'buy') return `${base} bg-emerald-600 text-white shadow-sm${ring}`;
  if (alert?.state === 'buy_near') return `${base} bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200${ring}`;
  if (alert?.state === 'sell') return `${base} bg-red-600 text-white shadow-sm${ring}`;
  if (alert?.state === 'sell_near') return `${base} bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200${ring}`;
  return `${base} ${selected ? 'bg-buy text-white shadow-sm' : 'bg-surface-overlay text-ink-secondary hover:text-ink-primary'}`;
}

function summaryFromLatest(point: QuantMaSlopeDashboardPoint): QuantMaSlopeTechnicalSummary {
  const annualized = point.slope200 == null ? null : point.slope200 * 252;
  return {
    price: point.close, ma200: point.ma200 ?? null,
    distance_to_ma200_pct: point.ma200 ? (point.close / point.ma200 - 1) * 100 : null,
    z_score: point.zscore200 ?? null, z_score_band: null,
    z_score_label: '数据更新中', ma200_slope_annualized_pct: annualized,
    ma200_trend: null, ma200_trend_label: annualized == null ? '数据不足' : annualized >= 0 ? '向上' : '向下',
  };
}

function moneyText(value: number): string { return `$${value.toFixed(2)}`; }
function signed(value: number, digits: number): string { return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`; }
function nullableSigned(value: number | null, digits: number): string { return value == null ? '—' : signed(value, digits); }
function nullableMoney(value: number | null): string { return value == null ? '—' : moneyText(value); }
function nullablePercent(value: number | null, digits: number): string { return value == null ? '—' : `${signed(value, digits)}%`; }
function nullableSlope(value: number | null | undefined): string { return value == null ? '—' : `${signed(value, 3)}%/天`; }
function nullableIndicator(value: number | null | undefined): string { return value == null ? '—' : signed(value, 3); }
function priceTooltip(value: unknown, name: unknown): [string, string] {
  if (Array.isArray(value)) return [`${moneyText(Number(value[0]))} – ${moneyText(Number(value[1]))}`, String(name)];
  return [moneyText(Number(value)), String(name)];
}
function axisDate(value: unknown): string { return String(value).slice(2); }
function compactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}
function axisTick() { return { fill: 'var(--color-ink-muted)', fontSize: 10 }; }
