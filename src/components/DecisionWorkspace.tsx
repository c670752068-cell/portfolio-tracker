import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Holding, QuantAnalysisSnapshot, QuantChannelReviewSnapshot } from '../types';
import type { OneTapRefreshState } from '../oneTapRefresh';
import { fetchChannelReview, fetchMaSlopeDashboard, type MaSlopeDashboardResult } from '../maSlopeQuery';
import { getServerChannelAlertsUrl, getServerMaSlopeUrl, getServerQuoteProxyUrl } from '../runtimeConfig';
import { heldTechnicalSymbols, technicalPresetSymbols, technicalSymbolName } from '../technicalSymbols';
import { decisionSignalRow, OBSERVATION_LABELS, OBSERVATION_RANGES, midChannel, nearLowerBand, nearUpperBand, annualSlope, compareZ, estimatedPreview, previewQuoteFrom, type PreviewQuote } from '../decisionSignals';
import { quantAnalysisFreshnessText } from '../quantAnalysis';
import { StockForwardValuationExplorer } from './StockForwardValuationExplorer';
import { MaSlopeExplorer } from './MaSlopeExplorer';
import { useSignalInbox } from '../useSignalInbox';
import { BreakoutRules } from './BreakoutDetails';
import { currentBreakout, breakoutLabel } from '../breakoutSignals';
import { pePosition, smaIndicators } from '../decisionIndicators';
import { useDecisionTechnicals } from '../useDecisionTechnicals';
import { PePositionView, SmaPositionView } from './DecisionIndicatorViews';
import { decisionAction } from '../decisionAction';
import { DecisionAnswerPanel } from './DecisionAnswerPanel';
import { drawdownDisplay } from '../drawdownDisplay';
import './DecisionWorkspace.css';

interface Props {
  initialSymbol?: string;
  snapshot: QuantAnalysisSnapshot;
  holdings?: readonly Holding[];
  loading?: boolean;
  error?: string;
  onRefresh?: () => void;
  refreshState?: OneTapRefreshState;
  cooldownSeconds?: number;
}
const EMPTY_HOLDINGS: readonly Holding[] = [];
const FAVORITES = [ ['指数 / ETF', ['QQQ', 'DIA', 'VOO', 'TQQQ', 'XLK', 'MAGS']], ['个股', ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOG', 'META', 'TSLA', 'AVGO']] ] as const;
const DECISION_FILTERS = [
  { value: 'all', label: '全部' }, { value: 'held', label: '已持仓' },
  { value: 'buy_observe', label: '接近/击穿下沿' }, { value: 'sell_observe', label: '接近/突破上沿' },
] as const;
type DecisionFilter = typeof DECISION_FILTERS[number]['value'];

export function DecisionWorkspace({ snapshot, holdings = EMPTY_HOLDINGS, loading, error, onRefresh, refreshState, cooldownSeconds = 0, initialSymbol }: Props) {
  const symbols = useMemo(() => [...new Set([...technicalPresetSymbols(snapshot, holdings), ...FAVORITES.flatMap(([, items]) => [...items])])], [snapshot, holdings]);
  const held = useMemo(() => heldTechnicalSymbols(holdings), [holdings]);
  const [selected, setSelected] = useState(initialSymbol && symbols.includes(initialSymbol) ? initialSymbol : symbols.includes('NVDA') ? 'NVDA' : symbols[0] ?? 'NDX');
  const [filter, setFilter] = useState<DecisionFilter>('all');
  const [zFilter, setZFilter] = useState('all');
  const [breakoutFilter, setBreakoutFilter] = useState('off');
  const [zSort, setZSort] = useState<'desc' | 'asc' | null>(null);
  const [notice, setNotice] = useState('');
  const [highlighted, setHighlighted] = useState<string[]>([selected]);
  const { inbox, batch, ingest, markRead } = useSignalInbox();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [mode, setMode] = useState<'closed' | 'preview'>('closed');
  const [dashboard, setDashboard] = useState<MaSlopeDashboardResult | null>(null);
  const [supplementalSlopes, setSupplementalSlopes] = useState<Record<string, { value: number; asOf: string; source: string }>>({});
  const [review, setReview] = useState<QuantChannelReviewSnapshot>(() => ({ review_time: '16:20', timezone: 'America/New_York', review_date: null, updated_at: null, symbols: Object.fromEntries(Object.entries(snapshot.symbols).flatMap(([symbol, item]) => item.ma_slope?.dashboard?.channel_alert ? [[symbol, item.ma_slope.dashboard.channel_alert]] : [])) }));
  const [reviewError, setReviewError] = useState('');
  const [liveQuote, setLiveQuote] = useState<{ symbol: string; quote: PreviewQuote | null } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const refreshReview = () => { if (document.visibilityState === 'visible') { setRefreshKey(value => value + 1); setNow(Date.now()); } };
    const timer = window.setInterval(refreshReview, 60_000);
    document.addEventListener('visibilitychange', refreshReview);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshReview); };
  }, []);
  const missingSlopes = symbols.filter((symbol) => !snapshot.symbols[symbol]?.ma_slope?.available).join(',');
  const storeSlope = useCallback((result: MaSlopeDashboardResult) => {
    const last = result.dashboard.series.findLast((point) => !point.is_partial);
    const value = last ? annualSlope(result.dashboard.series, last.date) : null;
    if (value != null && last) setSupplementalSlopes((current) => ({ ...current, [result.symbol]: { value, asOf: last.date, source: result.data_source } }));
  }, []);
  useEffect(() => {
    // Only fill genuinely missing own-ticker slopes; never request every ticker on each render.
    const queue = missingSlopes.split(',').filter(Boolean);
    const controller = new AbortController();
    let index = 0;
    const worker = async () => {
      while (index < queue.length && !controller.signal.aborted) {
        const symbol = queue[index++];
        try {
          const result = await fetchMaSlopeDashboard(getServerMaSlopeUrl() || '/api/portfolio/ma-slope', symbol, { range: '1y', slopeWindow: 8, signal: controller.signal });
          if (!controller.signal.aborted) storeSlope(result);
        } catch { /* An unavailable instrument stays explicitly marked as pending. */ }
      }
    };
    void Promise.all([worker(), worker()]);
    return () => controller.abort();
  }, [missingSlopes, snapshot.generated_at, storeSlope]);
  useEffect(() => {
    const controller = new AbortController();
    void fetchChannelReview(getServerChannelAlertsUrl() || '/api/portfolio/channel-alerts', controller.signal)
      .then((next) => { if (controller.signal.aborted) return; ingest(next.symbols); setReview((current) => ({ ...next, symbols: Object.fromEntries([...new Set([...Object.keys(next.symbols), ...Object.keys(current.symbols)])].map((symbol) => { const previous = current.symbols[symbol]; const incoming = next.symbols[symbol]; return [symbol, previous?.as_of && previous.as_of > (incoming?.as_of ?? '') ? previous : incoming ?? previous]; })) })); setReviewError(''); })
      .catch(() => { if (!controller.signal.aborted) setReviewError('收盘审查暂不可用，已展示的数据可能较旧。'); });
    return () => controller.abort();
  }, [snapshot.generated_at, refreshKey, ingest]);
  // 夜盘、盘前、盘后没有未收盘那根日线，盘中预览按选中股票的现价估算；跟着每分钟的刷新一起拉
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${getServerQuoteProxyUrl() || '/api/quotes'}?symbols=${encodeURIComponent(selected)}`, { cache: 'no-store', signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => { if (!controller.signal.aborted) setLiveQuote({ symbol: selected, quote: previewQuoteFrom(body, selected) }); })
      .catch(() => { /* 拿不到现价就显示暂无盘中数据 */ });
    return () => controller.abort();
  }, [selected, refreshKey]);
  const receiveDashboard = useCallback((result: MaSlopeDashboardResult) => {
    setDashboard(result);
    storeSlope(result);
    const alert = result.dashboard.channel_alert;
    if (alert) setReview((current) => ({ ...current, symbols: { ...current.symbols, [result.symbol]: (current.symbols[result.symbol]?.as_of ?? '') > (alert.as_of ?? '') ? current.symbols[result.symbol] : alert } }));
  }, [storeSlope]);
  const name = (symbol: string) => technicalSymbolName(symbol, holdings, snapshot.growth_watchlist?.names);
  const getRow = (symbol: string) => {
    const row = decisionSignalRow(snapshot, symbol, review.symbols[symbol]);
    const supplement = supplementalSlopes[symbol];
    return { ...row, slope: row.slope ?? supplement?.value ?? null, slopeAsOf: row.slope != null ? row.slopeAsOf : supplement?.asOf ?? null };
  };
  const rows = symbols.map(getRow);
  const matches = (row: typeof rows[number], value: DecisionFilter) => value === 'all'
    || (value === 'held' ? held.has(row.symbol) : value === 'buy_observe' ? nearLowerBand(row.z) : nearUpperBand(row.z));
  const unreadFor = (value: DecisionFilter) => inbox.unread.filter((entry) => value === 'buy_observe'
    ? entry.category.startsWith('buy') : value === 'sell_observe' ? entry.category.startsWith('sell') : false);
  const matchesZFilter = (item: typeof rows[number]) => zFilter === 'all'
    || (zFilter === 'buy_observe' ? nearLowerBand(item.z) : zFilter === 'sell_observe' ? nearUpperBand(item.z) : midChannel(item.z));
  const visible = rows.filter((row) => matches(row, filter)
    && matchesZFilter(row)
    && (breakoutFilter === 'off' || (currentBreakout(review, row.symbol) && (breakoutFilter === 'all' || currentBreakout(review, row.symbol)?.direction === breakoutFilter)))
    && `${row.symbol} ${name(row.symbol)}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort(zSort ? compareZ(zSort) : (a, b) => Number(highlighted.includes(b.symbol)) - Number(highlighted.includes(a.symbol)));
  const selectFavorite = (symbol: string) => {
    const hidden = !visible.some(item => item.symbol === symbol);
    if (hidden) { setFilter('all'); setZFilter('all'); setBreakoutFilter('off'); setSearch(''); }
    setSelected(symbol); setMode('closed'); setHighlighted([symbol]); setZSort(null);
    setNotice(`${hidden ? '已切回“全部”，' : ''}已定位 ${symbol}；详情、斜率曲线与 PE 估值同步。`);
  };
  const selectFilter = (value: DecisionFilter) => {
    const unread = unreadFor(value);
    setFilter(value); setExpanded(false); setHighlighted(unread.map(e => e.symbol));
    if (unread.length) {
      setExpanded(unread.length > 6);
      setSearch(''); setZFilter('all'); setBreakoutFilter('off'); setZSort(null); setSelected(unread[0].symbol); setMode('closed');
      setNotice(`新增：${unread.map(e => `${e.symbol} ${name(e.symbol)}`).join('、')}。已定位并标记为已读。`);
      markRead(unread.map(e => e.id));
    } else setNotice('');
  };
  const displayedRows = expanded ? visible : visible.slice(0, 6);
  const technicalKey = [...new Set([selected, ...displayedRows.map(item => item.symbol)])].join(',');
  const technicals = useDecisionTechnicals(technicalKey, snapshot.generated_at, refreshKey);
  const indicators = useMemo(() => Object.fromEntries([...new Set([...symbols, selected])].map(symbol => [symbol, {
    sma: smaIndicators(technicals[symbol]?.result?.dashboard ?? snapshot.symbols[symbol]?.ma_slope?.dashboard),
    pe: pePosition(symbol, snapshot.pe_history, snapshot.index_etf_valuation),
  }])), [symbols, selected, technicals, snapshot]);
  const selectedSma = indicators[selected]?.sma ?? smaIndicators();
  const actions = Object.fromEntries(symbols.map(symbol => [symbol, decisionAction(snapshot, symbol, held.has(symbol), indicators[symbol]?.sma, now)]));
  const selectedAction = actions[selected] ?? decisionAction(snapshot, selected, held.has(selected), selectedSma, now);
  const row = getRow(selected);
  const selectedDashboard = dashboard?.symbol === selected ? dashboard : null;
  const points = selectedDashboard?.dashboard.series ?? [];
  const live = points.at(-1);
  const partial = live?.is_partial ? live : null;
  const closedPoint = points.findLast((point) => !point.is_partial);
  const fallbackSlope = closedPoint ? annualSlope(points, closedPoint.date) : null;
  const busy = loading || ['requested', 'throttled', 'waiting'].includes(refreshState?.phase ?? '');

  return <div className="decision-workspace space-y-4 md:space-y-5">
    <section className="decision-layout decision-view-indicators" data-testid="decision-signals">
      <div className="decision-panel">
      <header className="decision-title-row">
        <h2>股票与指数决策</h2>
        <div className="decision-search">
          <input aria-label="搜索股票代码或中文名称" placeholder="搜索股票代码或中文名称" value={search} onChange={(event) => { setSearch(event.target.value); setExpanded(false); }} />
          <button className="decision-button" disabled={busy || cooldownSeconds > 0} onClick={() => { setRefreshKey((value) => value + 1); onRefresh?.(); }}>{busy ? '刷新中…' : cooldownSeconds ? `${cooldownSeconds}s` : '刷新'}</button>
        </div>
      </header>
      <div className="decision-favorites" aria-label="常用标的">
        {FAVORITES.map(([label, items]) => <div className="favorite-group" key={label}><span>{label}<small className="favorite-scroll-hint">左右滑动查看更多 →</small></span><div className="favorite-scroll" aria-label={`${label}常用标的`} tabIndex={0}>{items.map(symbol => <button type="button" key={symbol} aria-pressed={selected === symbol} onClick={() => selectFavorite(symbol)} data-favorite={symbol}><strong>{symbol}</strong><small>{name(symbol)}</small></button>)}</div></div>)}
      </div>
      <div className="decision-filters" aria-label="通道提醒筛选">
        {DECISION_FILTERS.map((option) => { const unread = unreadFor(option.value); const animation = unread.filter(e => batch.includes(e.id)).map(e => e.id).join('|'); return <button key={option.value} aria-pressed={filter === option.value} onClick={() => selectFilter(option.value)} data-signal-filter={option.value}>{option.label} <span>{rows.filter((item) => matches(item, option.value)).length}</span>{unread.length > 0 && <em key={animation || 'static'} className={`signal-unread ${option.value.startsWith('buy') ? 'is-buy' : 'is-sell'} ${animation ? 'animate-entry' : ''}`} aria-label={`${unread.length} 个未读新增`}>+{unread.length}</em>}</button>; })}
        <label className="decision-z-filter"><span className="sr-only">露头筛选</span><select aria-label="露头筛选" value={breakoutFilter} onChange={e => { setBreakoutFilter(e.target.value); setFilter('all'); setZFilter('all'); setSearch(''); setExpanded(false); setNotice(''); }}><option value="off">露头 · 不限</option><option value="all">全部露头</option><option value="up">↑ 向上露头</option><option value="down">↓ 向下露头</option></select></label><BreakoutRules />
        <label className="decision-z-filter"><span className="sr-only">标准差动能筛选</span><select aria-label="标准差动能筛选" value={zFilter} onChange={(event) => { setZFilter(event.target.value); setExpanded(false); }}><option value="all">标准差动能 · 全部</option><option value="buy_observe">接近/击穿下沿：Z ≤ −1.25</option><option value="sell_observe">接近/突破上沿：Z ≥ +1.25</option><option value="neutral">通道中间：−1.25 &lt; Z &lt; +1.25</option></select></label>
        <label className="decision-z-filter decision-z-sort-mobile"><span className="sr-only">Z-Score 排序</span><select aria-label="Z-Score 排序" value={zSort ?? 'none'} onChange={(event) => setZSort(event.target.value === 'desc' || event.target.value === 'asc' ? event.target.value : null)}><option value="none">排序 · 默认</option><option value="desc">Z 从高到低</option><option value="asc">Z 从低到高</option></select></label>
      </div>
      {notice && <p className="decision-new-notice" role="status">{notice}</p>}
      {!notice && inbox.unread.length > 0 && <p className="decision-new-notice" role="status">新增：{inbox.unread.map(e => `${e.symbol} ${name(e.symbol)}`).join('、')}。点击对应分类查看。</p>}
      <div className="decision-data-line"><span>{quantAnalysisFreshnessText(snapshot.generated_at)}</span><details className="decision-data-help"><summary>口径与更新时间</summary><div><p>观察分区按完整收盘 Z-Score，只看顶部和底部，价格优先：Z ≤ −1.5 即价格击穿 200 日均线 −1.5σ 通道下沿，才算买点；Z ≥ +1.5 即突破 +1.5σ 上沿，才算卖点；±1.25 ~ ±1.5 为接近下沿 / 上沿；−1.25 ~ +1.25 在通道中间，不操作。±1.5 仍是极值与推送阈值，不因观察分区改变。</p><p>当前行动整理现有买入、卖出裁决；缺失、过期或矛盾时显示待核查。继续持有仅表示当前规则未触发卖出，不是收益保证。只提示，不自动下单。</p><p>完整收盘审查 {review.review_date ?? '读取中'}{review.confirmed_date && review.confirmed_date === review.review_date ? '（已按最终价复核）' : ''} · 每天美东 {review.review_time}，{review.confirm_time ?? '18:00'} 再用最终收盘价复核；露头审查 {review.breakout_date ?? '读取中'}。+N 为未读新入，非分类总数。</p></div></details></div>
      {(error || reviewError || refreshState?.message) && <p role="status" className="decision-note">{error || reviewError || refreshState?.message}</p>}
      {!!review.failed_symbols?.length && <p className="decision-note" role="status">部分日线审查暂缺：{review.failed_symbols.join('、')}；服务器自动重试，不用缺失数据生成露头提醒。</p>}
      {!!snapshot.growth_watchlist?.unresolved?.length && <p className="decision-note">待判断标的：{snapshot.growth_watchlist.unresolved.map((item) => item.symbol).join('、')}；不把未知数据标记为接近或击穿下沿。</p>}
        <div className="min-w-0">
          <div className="decision-table-head"><span>股票</span><span>观察信号</span><span>回撤深度<small>负值 · 快照评估</small></span><span>200DMA 年化斜率<small>20日回看 · 年化</small></span><span>SMA 短线 / 趋势<small>8日回看 · %/天</small></span><span>PE 历史位置<small>TTM · 近5年低 → 高</small></span><span><button type="button" className="decision-z-sort" title="点击排序：从高到低 → 从低到高 → 恢复默认" onClick={() => setZSort(current => current === null ? 'desc' : current === 'desc' ? 'asc' : null)}>Z-Score {zSort === 'desc' ? '↓' : zSort === 'asc' ? '↑' : '↕'}</button></span></div>
          <div className="decision-rows" aria-label="股票决策列表">
            {displayedRows.map((item) => <button key={item.symbol} className={`decision-row ${item.symbol === selected ? 'is-selected' : ''} ${highlighted.includes(item.symbol) ? 'is-new-entry' : ''}`} aria-pressed={item.symbol === selected} onClick={() => { setSelected(item.symbol); setMode('closed'); markRead(inbox.unread.filter(e => e.symbol === item.symbol).map(e => e.id)); revealMobileDetail(); }} data-symbol={item.symbol} data-channel-state={item.state} data-action={actions[item.symbol].kind}>
              <span className="decision-stock"><strong>{item.symbol}</strong><small>{name(item.symbol)}</small>{held.has(item.symbol) && <em className="held-tag">已持仓</em>}</span>
              <span className={`signal-badge signal-${item.state}`} title={OBSERVATION_RANGES[item.state]}>{OBSERVATION_LABELS[item.state]}{inbox.unread.some(e => e.symbol === item.symbol) && <small className="signal-new-label">新入</small>}</span>
              <span className="decision-depth"><small className="mobile-metric-label">回撤</small><DrawdownValue value={item.decision.currentDrawdownPct} />{item.decision.priceLabel !== item.symbol && <small>依据 {item.decision.priceLabel}</small>}</span>
              <span className={`decision-slope ${item.slope != null && item.slope < 0 ? 'is-negative' : ''}`}><small className="mobile-metric-label">年化斜率</small><strong>{pct(item.slope, true)}</strong><small>{item.slopeAsOf ?? '待更新'}</small></span>
              <span className="decision-sma-cell"><small className="mobile-metric-label">SMA · 8日回看</small><SmaPositionView compact value={indicators[item.symbol].sma} error={technicals[item.symbol]?.error} /></span>
              <span className="decision-pe-cell"><small className="mobile-metric-label">PE 历史位置</small><PePositionView compact value={indicators[item.symbol].pe} />{indicators[item.symbol].pe.basis !== item.symbol && <small>参考 {indicators[item.symbol].pe.basis}</small>}</span>
              <span className={`decision-z ${item.z != null ? item.z < 0 ? 'is-negative-z' : item.z > 0 ? 'is-positive-z' : '' : ''}`}><small className="mobile-metric-label">Z-Score</small><strong>{signed(item.z)}</strong><small>{item.asOf ?? '待审查'}</small></span>
              {currentBreakout(review, item.symbol) && <span className="decision-breakout-row">{breakoutLabel(currentBreakout(review, item.symbol)!.direction)} · 连续{currentBreakout(review, item.symbol)!.sessions}个同号交易日后穿越零轴</span>}
            </button>)}
          </div>
          {!visible.length && <p className="decision-empty" role="status">没有符合当前筛选的标的。可清空搜索或切换“全部”。</p>}
          <footer className="decision-list-footer"><span>已显示 {expanded ? visible.length : Math.min(8, visible.length)} / {visible.length}</span>{visible.length > 8 && <button onClick={() => setExpanded(!expanded)}>{expanded ? '收起列表 ⌃' : '展开全部 ⌄'}</button>}<span>绿色＝接近或击穿通道下沿 · 红色＝接近或突破通道上沿 · 灰色＝通道中间 · 不等于买卖指令</span></footer>
        </div>
      </div>
      <DecisionAnswerPanel key={selected} symbol={selected} name={name(selected)} held={held.has(selected)} action={selectedAction}
        mode={mode} onModeChange={setMode}
        onReturnToList={() => document.querySelector(`.decision-row[data-symbol="${selected}"]`)?.scrollIntoView({ block: 'center' })}
        closed={{ date: row.asOf, close: review.symbols[selected]?.close ?? null, z: row.z, annualSlope: row.slope ?? fallbackSlope, slopeDate: row.slope != null ? row.slopeAsOf : closedPoint?.date ?? null }}
        preview={partial ? { date: partial.date, close: partial.close, z: partial.zscore200 ?? null, annualSlope: annualSlope(points, partial.date), slopeDate: partial.date } : estimatedPreview(points, liveQuote?.symbol === selected ? liveQuote.quote : null)}
      />
    </section>
    <MaSlopeExplorer snapshot={snapshot} holdings={holdings} selectedSymbol={selected} onSelectedSymbolChange={setSelected} onDashboard={receiveDashboard} displayMode={mode} onDisplayModeChange={setMode} breakoutEvents={review.breakout_history} compact />
    <StockForwardValuationExplorer key={selected} selectedSymbol={selected} onSelectedSymbolChange={setSelected} compact valuation={snapshot.stock_forward_valuation} ttmHistory={snapshot.pe_history} forwardIndexHistory={snapshot.pe_history_forward} indexEtfValuation={snapshot.index_etf_valuation} />
  </div>;
}
function DrawdownValue({ value }: { value: number | null | undefined }) {
  const negative = value != null && Number.isFinite(value) && value !== 0;
  return <strong className={`drawdown-value ${negative ? 'is-negative' : ''}`}>{drawdownDisplay(value)}</strong>;
}
function revealMobileDetail() {
  if (window.matchMedia('(max-width: 1100px)').matches) requestAnimationFrame(() => document.querySelector('.decision-detail')?.scrollIntoView({ block: 'start' }));
}
function signed(value: number | null | undefined) { return value == null || !Number.isFinite(value) ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}`; }
function pct(value: number | null | undefined, showSign = false) { return value == null || !Number.isFinite(value) ? '—' : `${showSign && value >= 0 ? '+' : ''}${value.toFixed(2)}%`; }
