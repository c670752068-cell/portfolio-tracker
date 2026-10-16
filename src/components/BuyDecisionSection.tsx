import { useEffect, useMemo, useState } from 'react';
import { CASH_EQUIVALENT_SYMBOLS } from '../assetClass';
import { buildDepthPriceView } from '../depthPrice';
import { depthQuotePrice, depthQuoteSnapshot, type DepthQuote } from '../depthQuotePrice';
import { quantSnapshotQuote } from '../depthWindowPrice';
import { formatMoney } from '../format';
import { REFRESH_CADENCE } from '../refreshCadence';
import { stockFamilyAllocation } from '../positionAllocation';
import { depthConditionSatisfied, isQuantAnalysisStale, lookupQuantSymbol, quantAnalysisAgeHours, quantAnalysisFreshnessText } from '../quantAnalysis';
import {
  closedQuoteText,
  formatPriceSession,
  priceSessionLabel,
  quoteSessionMismatchText,
} from '../quoteSession';
import type { DisplayCurrency, ExchangeRates, Holding, QuantAnalysisSnapshot, QuantDepthPresentation, QuantDrawdownResearch, QuantDrawdownResearchHorizon, QuantPanicSymbolStatus, QuantSignalStatWindow, QuantSymbolAnalysis } from '../types';
import { SymbolVerdictCard } from './SymbolVerdictCard';
import { ValuationCard, type ValuationSettings } from './ValuationCard';

type OpportunitySide = 'buy' | 'sell';

interface BuyDecisionSectionProps {
  snapshot: QuantAnalysisSnapshot | null;
  holdings?: Holding[];
  monitoredQuotes?: ReadonlyMap<string, DepthQuote>;
  initialSymbol?: string;
  initialSide?: OpportunitySide;
  loading?: boolean;
  error?: string;
  onRefresh?: () => void;
  displayCurrency?: DisplayCurrency;
  rates?: ExchangeRates;
  valuationSettings?: ValuationSettings;
  totalAssets?: number;
}

const USD_RATES: ExchangeRates = {
  USD: 1, CNY: 1, HKD: 1, JPY: 1, EUR: 1, GBP: 1,
  updatedAt: null, source: 'fallback',
};

const DEFAULT_VALUATION_SETTINGS: ValuationSettings = {
  peApiKey: '',
  valuationAnchorStart: '2025-04-01',
  valuationAnchorEnd: '2025-04-30',
  valuationManualAnchors: {},
  valuationAtAnchorPct: 5,
  valuationNearAnchorPct: 15,
};

function numberText(value: unknown, suffix = ''): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}${suffix}` : '暂无';
}

function StatWindow({ label, stat }: { label: string; stat: QuantSignalStatWindow }) {
  return (
    <div className="rounded-lg border border-neutral/40 p-2">
      <div className="font-medium">{label}</div>
      {stat.sample_insufficient || stat.n < 20 || stat.win_rate === null ? (
        <div className="mt-1 tabular-nums text-trim">样本不足，勿下结论（n={stat.n}）</div>
      ) : (
        <div className="mt-1 tabular-nums text-ink-secondary">历史成功率 {(stat.win_rate * 100).toFixed(2)}%（n={stat.n}）</div>
      )}
    </div>
  );
}

function DepthStat({ stat }: { stat: NonNullable<QuantSymbolAnalysis['depth_stats']> }) {
  const insufficient = stat.sample_insufficient || stat.n < 20 || stat.win_rate_60d === null;
  return (
    <div className="mt-3 rounded-lg border border-neutral/40 p-3 text-sm">
      <div className="font-medium tabular-nums">回撤深度 {stat.level_pct}%</div>
      {insufficient ? (
        <div className="mt-1 tabular-nums text-trim">样本不足，勿下结论（n={stat.n}）</div>
      ) : (
        <div className="mt-1 tabular-nums text-ink-secondary">60 日历史成功率 {(stat.win_rate_60d! * 100).toFixed(2)}%（n={stat.n}）</div>
      )}
      <div className="mt-1 text-xs text-ink-muted">含熊市样本：{stat.bear_included ? '是' : '否'}</div>
    </div>
  );
}

function usdPrice(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '暂无';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function researchHorizon(
  research: QuantDrawdownResearch,
  depth: number | null,
): QuantDrawdownResearchHorizon | null {
  if (depth === null) return null;
  const level = research.levels.find((item) => item.depth_pct === depth);
  return level?.horizons[String(research.primary_horizon_days)] ?? null;
}

function ResearchResult({
  label,
  depth,
  horizon,
}: {
  label: string;
  depth: number;
  horizon: QuantDrawdownResearchHorizon;
}) {
  return (
    <div className="rounded-lg border border-neutral/40 bg-surface-overlay/40 p-3">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="mt-1 font-semibold tabular-nums">回撤 {depth}% · {horizon.horizon_trading_days} 日上涨 {horizon.win_count}/{horizon.n}（{horizon.win_rate_pct?.toFixed(2) ?? '暂无'}%）</div>
      <div className="mt-1 text-xs tabular-nums text-ink-secondary">中位 {signedPercent(horizon.median_return_pct)} · 最差 {signedPercent(horizon.worst_return_pct)}</div>
    </div>
  );
}

function FocusedDrawdownResearch({ research }: { research: QuantDrawdownResearch }) {
  const best = researchHorizon(research, research.best_supported_depth_pct);
  const observed = researchHorizon(research, research.most_observed_depth_pct);
  const usesBenchmark = research.basis_symbol !== research.symbol;
  const observedIsDistinct = (
    research.most_observed_depth_pct !== research.best_supported_depth_pct
  );
  return (
    <div className="mb-4 rounded-lg border border-neutral/40 bg-surface-overlay/30 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">
          {research.symbol} 回撤胜率研究{usesBenchmark ? `（按 ${research.basis_symbol} 触发）` : ''}
        </h3>
        <span className="text-xs tabular-nums text-ink-muted">{research.available_start} 至 {research.available_end}</span>
      </div>
      <p className="mt-1 text-xs text-ink-muted">每轮回撤只取首次触线 · {research.completed_cycle_count} 轮已完成 · {research.ongoing_cycle_count} 轮进行中</p>
      {usesBenchmark && (
        <p className="mt-1 text-xs font-medium text-ink-secondary">
          {research.basis_symbol} 负责回撤触发，{research.symbol} 负责计算后续收益
        </p>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {research.best_supported_depth_pct !== null && best && <ResearchResult label={`高胜率档位（至少 ${research.minimum_comparison_samples} 轮且胜率 ≥ ${research.minimum_win_rate_pct}%）`} depth={research.best_supported_depth_pct} horizon={best} />}
        {research.best_supported_depth_pct === null && (
          <div className="rounded-lg border border-neutral/40 bg-surface-overlay/40 p-3 text-sm text-ink-secondary sm:col-span-2">
            2021 年至今没有同时达到 ≥{research.minimum_comparison_samples} 轮且胜率 ≥{research.minimum_win_rate_pct}% 的档位。
          </div>
        )}
        {observed && observedIsDistinct && (
          <ResearchResult label="常见档位" depth={research.most_observed_depth_pct} horizon={observed} />
        )}
      </div>
      <details className="mt-3 rounded-lg border border-neutral/30 px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">查看全部回撤档位</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-xs tabular-nums">
            <thead className="text-ink-muted"><tr><th className="py-1">回撤</th><th>20 日</th><th>60 日</th><th>120 日</th></tr></thead>
            <tbody>{research.levels.map((level) => <tr key={level.depth_pct} className="border-t border-neutral/20">
              <td className="py-1.5 font-medium">{level.depth_pct}%</td>
              {[20, 60, 120].map((days) => {
                const item = level.horizons[String(days)];
                return <td key={days}>{item ? `${item.win_count}/${item.n} · ${signedPercent(item.median_return_pct)}` : '—'}</td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>
      </details>
      <p className="mt-2 text-xs text-ink-muted">这是历史频数与收益记录，不会自动修改现有买入规则。</p>
    </div>
  );
}

/**
 * This deliberately performs no gate calculation. It only turns the backend's
 * explicit pass/block/unknown lists into the five fixed presentation rows so
 * older snapshots remain explainable while the exported detailed layer list
 * is rolling out.
 */
function finalVerdictSatisfied(snapshot: QuantAnalysisSnapshot | null, symbol: string): boolean {
  return snapshot ? depthConditionSatisfied(snapshot, symbol) : false;
}

const DEPTH_STYLE = {
  ready: {
    panel: 'border-gain/40 bg-gain/10',
    badge: 'bg-gain text-surface-base',
    progress: 'accent-gain',
  },
  near: {
    panel: 'border-trim/40 bg-trim/10',
    badge: 'bg-trim text-ink-primary',
    progress: 'accent-trim',
  },
  far: {
    panel: 'border-neutral/40 bg-surface-overlay/50',
    badge: 'bg-neutral/30 text-ink-secondary',
    progress: 'accent-neutral',
  },
} as const;

function DepthHighlight({
  analysis,
  presentation,
  title,
  quotePrice,
  quote,
}: {
  analysis: QuantSymbolAnalysis;
  presentation: QuantDepthPresentation | undefined;
  title: string;
  quotePrice: number | null;
  quote: ReturnType<typeof depthQuoteSnapshot>;
}) {
  const depth = analysis.depth_window;
  if (!depth?.applicable) return null;
  if (!presentation) {
    return <div className="rounded-lg border border-neutral/40 p-3 text-sm text-ink-muted">深度位展示状态待下一份快照生成。</div>;
  }
  const style = DEPTH_STYLE[presentation.status];
  const badge = presentation.status === 'ready'
    ? '深度位 ✓ 已达标'
    : presentation.status === 'near'
      ? `深度位 接近 · 还差 ${presentation.gap_pct.toFixed(2)} 点`
      : '深度位 未达标';
  const prices = buildDepthPriceView(depth, quotePrice, {
    currentPrice: depth.current_price ?? null,
    highPrice: depth.high_price ?? null,
    thresholdPrice: depth.threshold_price ?? null,
  });
  const priceSession = prices.source === 'derived'
    ? formatPriceSession(quote?.session, quote?.priceTime || quote?.timestamp)
    : priceSessionLabel(depth.price_session);
  const mismatch = quoteSessionMismatchText(depth.price_session, quote);
  const closedText = closedQuoteText(
    quote?.session ?? depth.price_session,
    quote?.regularMarketPrice ?? quote?.price ?? prices.currentPrice,
  );
  const priceNote = depth.price_note?.startsWith('夜盘价格暂无')
    ? '夜盘价格暂无（数据源不覆盖）'
    : depth.price_note;
  return (
    <div className={`min-w-0 overflow-hidden rounded-lg border p-3 text-sm ${style.panel}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">{title}</div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold tabular-nums ${style.badge}`}>{badge}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div><span className="block text-xs text-ink-muted">当前回撤</span><strong className="text-2xl tabular-nums">{numberText(depth.current_pct, '%')}</strong></div>
        <div><span className="block text-xs text-ink-muted">阈值</span><strong className="text-2xl tabular-nums">{numberText(depth.threshold_pct, '%')}</strong></div>
      </div>
      {closedText && (
        <div className="mt-3 rounded-lg bg-surface-raised/70 p-2 text-xs tabular-nums text-ink-secondary">
          {closedText}
        </div>
      )}
      {!closedText && prices.source !== 'unavailable' && prices.currentPrice !== null && prices.highPrice !== null && prices.thresholdPrice !== null && (
        <div className="mt-3 rounded-lg bg-surface-raised/70 p-2 text-xs text-ink-secondary">
          现价 {usdPrice(prices.currentPrice)}{priceSession && `（${priceSession}）`} · 高点 {prices.source === 'derived' ? '~' : ''}{usdPrice(prices.highPrice)} · 阈值价 {prices.source === 'derived' ? '~' : ''}{usdPrice(prices.thresholdPrice)}
          {prices.source === 'derived' && (
            <div className="mt-1 text-ink-muted">
              <div>价格由行情代理现价与量化回撤反推，与量化取价时段（{priceSessionLabel(depth.price_session)}）可能有偏差</div>
              <div>高点为反推值，会随现价与量化回撤的更新时差而小幅变动；量化系统提供真实高点后此处将改为固定值。</div>
            </div>
          )}
        </div>
      )}
      {priceNote && <div className="mt-2 text-xs text-ink-muted">{priceNote}</div>}
      {mismatch && <div className="mt-2 text-xs text-trim">{mismatch}</div>}
      <div className="mt-3 flex min-w-0 items-center gap-3">
        <progress aria-label="深度位进度" className={`h-3 min-w-0 flex-1 ${style.progress}`} max={100} value={presentation.progress_pct} />
        {presentation.status === 'ready' && <span className="text-xs font-semibold tabular-nums">超出 {presentation.excess_pct.toFixed(2)} 点</span>}
      </div>
      {!closedText && priceSessionLabel(depth.price_session) && <div className="mt-2 text-xs text-ink-muted">取价时段：{priceSessionLabel(depth.price_session)}</div>}
      <div className={`mt-3 tabular-nums ${depth.win_rate_60d === null ? 'text-ink-muted opacity-70' : 'text-buy'}`}>
        {depth.win_rate_60d === null
          ? `60 日暂无历史记录（n=${depth.n}）`
          : <><strong className="text-xl">60 日上涨 {(depth.win_rate_60d * 100).toFixed(2)}%（n={depth.n}）</strong></>}
      </div>
    </div>
  );
}

function nullableUsdPrice(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? formatMoney(value) : '暂无';
}

function OneXEntryGate({ status }: { status: QuantPanicSymbolStatus }) {
  const gate = status.entry_gate;
  if (!gate) {
    return <div className="mt-3 rounded-lg border border-neutral/40 bg-surface-overlay/40 p-3 text-xs text-ink-muted">1× 基准判定待下一次量化快照生成。</div>;
  }
  const stateClass = gate.available && gate.passed ? 'border-gain/50 bg-gain/10 text-gain' : 'border-trim/50 bg-trim/10 text-trim';
  const decisionLabel = gate.price_basis === 'close' ? '闭市价' : '判定价';
  const untouchedText = gate.moving_averages
    .filter((movingAverage) => !movingAverage.touched)
    .map((movingAverage) => `MA${movingAverage.period} 还差 ${movingAverage.gap_pct.toFixed(2)}%`)
    .join('、');
  const referenceLabel = gate.reference_session ? priceSessionLabel(gate.reference_session) : '扩展时段';
  return (
    <div className="mt-3 rounded-lg border border-neutral/40 bg-surface-overlay/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>1× 基准判定</strong>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${stateClass}`}>
          {!gate.available ? '不可判定' : gate.passed ? '条件已满足' : '条件未满足'}
        </span>
      </div>
      {!gate.available ? <p className="mt-2 text-xs text-ink-muted">{gate.reason}</p> : <>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <span className="block text-xs text-ink-muted">判定基准</span>
            <strong className="text-xl tabular-nums">{gate.benchmark} {decisionLabel} {nullableUsdPrice(gate.decision_close)}</strong>
          </div>
          <div>
            <span className="block text-xs text-ink-muted">自高点回撤</span>
            <strong className="text-xl tabular-nums">{numberText(gate.drawdown.current_pct, '%')}{gate.drawdown.required_pct === null ? '（不适用）' : ` / 阈值 ${numberText(gate.drawdown.required_pct, '%')}`}</strong>
          </div>
        </div>
        {gate.drawdown.passed === true && gate.passed === false && untouchedText && (
          <p className="mt-3 text-sm font-medium text-trim">回撤条件已满足，卡在均线：{untouchedText}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {gate.moving_averages.map((movingAverage) => <span key={movingAverage.period} className={`rounded-md px-2 py-1 text-xs tabular-nums ${movingAverage.touched ? 'bg-gain/10 text-gain' : 'bg-surface-base text-ink-secondary'}`}>
            MA{movingAverage.period} {movingAverage.touched ? '已触及' : `还差 ${movingAverage.gap_pct.toFixed(2)}%`}
          </span>)}
        </div>
        {gate.reference_price !== null && <div className="mt-2 text-xs text-ink-muted">{referenceLabel}价 {nullableUsdPrice(gate.reference_price)}（仅展示，不改变条件）</div>}
        <p className="mt-2 text-xs text-ink-muted">{gate.reason}</p>
      </>}
    </div>
  );
}

function ReviewCheckpointStrip({ snapshot }: { snapshot: QuantAnalysisSnapshot }) {
  const checkpoint = snapshot.review_checkpoint;
  if (!checkpoint) return null;
  return (
    <div className={`rounded-xl border p-3 text-sm ${checkpoint.stale ? 'border-trim/40 bg-trim/10' : 'border-neutral/40 bg-surface-raised'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>定时审查：{checkpoint.label}</strong>
        <span className="text-xs tabular-nums text-ink-muted">美股交易日 {checkpoint.us_trading_day}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-ink-secondary">
        <span>{checkpoint.stale ? '刷新未完成，保留上一份快照' : `本次已通知 ${checkpoint.notifications_sent} 条`}</span>
        <span>下一检查点 {checkpoint.next_at}</span>
        {checkpoint.error && <span className="text-trim">{checkpoint.error}</span>}
      </div>
    </div>
  );
}

function PanicWindowStatus({ status }: { status: QuantPanicSymbolStatus }) {
  return (
    <div className="mb-4 min-w-0 overflow-hidden rounded-lg border border-neutral/40 bg-surface-overlay/40 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{status.display.title}</strong>
        <span className="rounded-full bg-neutral/20 px-2 py-1 text-xs font-semibold text-ink-secondary">{status.display.state_label}</span>
      </div>
      <OneXEntryGate status={status} />
      <div className={`mt-3 rounded-lg border p-3 ${status.panic.open ? 'border-loss/60 bg-loss/15' : 'border-neutral/40 bg-surface-overlay/50'}`}>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${status.panic.open ? 'bg-loss text-surface-base' : 'bg-neutral/30 text-ink-secondary'}`}>
          恐慌位 {status.panic.open ? '✓ 已触发' : '✗ 未触发'}
        </span>
        <div className="mt-2 text-xs text-ink-secondary">{status.panic.explanation}</div>
        {status.panic.triggered_session && <div className="mt-1 text-xs font-medium">触发时段：{priceSessionLabel(status.panic.triggered_session)}</div>}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <progress className="h-2 flex-1 accent-loss" max={100} value={status.target.progress_pct} />
        <span className="text-xs font-semibold tabular-nums">{status.display.progress_text}</span>
      </div>
      {status.stop_reason && <div className="mt-2 text-xs text-ink-muted">停止原因：{status.stop_reason}</div>}
    </div>
  );
}

export function BuyDecisionSection({ snapshot, holdings = [], monitoredQuotes = new Map(), initialSymbol = '', initialSide, loading = false, error = '', onRefresh, displayCurrency = 'USD', rates = USD_RATES, valuationSettings = DEFAULT_VALUATION_SETTINGS, totalAssets = 0 }: BuyDecisionSectionProps) {
  const monitoredSymbols = useMemo(() => snapshot
    ? Object.keys(snapshot.symbols)
      .filter((item) => !CASH_EQUIVALENT_SYMBOLS.has(item.toUpperCase()))
      .sort((left, right) => {
        const leftSatisfied = depthConditionSatisfied(snapshot, left);
        const rightSatisfied = depthConditionSatisfied(snapshot, right);
        return Number(rightSatisfied) - Number(leftSatisfied) || left.localeCompare(right);
      })
    : [], [snapshot]);
  const firstSymbol = monitoredSymbols.includes(initialSymbol.toUpperCase())
    ? initialSymbol.toUpperCase()
    : monitoredSymbols[0] || '';
  const [symbol, setSymbol] = useState(firstSymbol);
  const [symbolMenuOpen, setSymbolMenuOpen] = useState(false);
  const selectedSymbol = monitoredSymbols.includes(symbol) ? symbol : firstSymbol;
  const selectedSatisfied = finalVerdictSatisfied(snapshot, selectedSymbol);
  const result = useMemo(() => snapshot && selectedSymbol ? lookupQuantSymbol(snapshot, selectedSymbol) : null, [snapshot, selectedSymbol]);
  const snapshotAgeHours = snapshot ? quantAnalysisAgeHours(snapshot.generated_at) : null;
  const foundAnalysis = result?.found ? result.analysis : undefined;
  const hasSignalStats = Object.keys(foundAnalysis?.signal_stats ?? {}).length > 0;
  const hasDepthStats = Boolean(foundAnalysis?.depth_stats);
  const panicStatus = snapshot?.panic_window?.symbols[selectedSymbol];
  const depthPresentation = snapshot?.summary?.depth_states[selectedSymbol];
  const allocation = stockFamilyAllocation(selectedSymbol, holdings, totalAssets, rates);
  const selectedHoldingQuotePrice = depthQuotePrice(holdings, new Map(), selectedSymbol);
  const selectedMonitoredQuotePrice = depthQuotePrice(holdings, monitoredQuotes, selectedSymbol);
  const selectedQuantQuote = quantSnapshotQuote(snapshot, selectedSymbol);
  const selectedQuantQuotePrice = selectedQuantQuote?.price ?? null;
  const selectedDepthQuotePrice = selectedMonitoredQuotePrice ?? selectedQuantQuotePrice;
  const selectedDepthQuote = depthQuoteSnapshot(holdings, monitoredQuotes, selectedSymbol) ?? selectedQuantQuote;
  const selectedDepthPriceSource = selectedHoldingQuotePrice !== null
    ? 'holding'
    : selectedMonitoredQuotePrice !== null
      ? 'monitored'
      : selectedQuantQuotePrice !== null
        ? 'quant'
        : 'unavailable';
  useEffect(() => {
    if (initialSide !== 'buy') return;
    window.requestAnimationFrame(() => {
      document.getElementById('buy-condition-detail')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [initialSide]);

  return (
    <section className="space-y-4">
      {snapshot && <ReviewCheckpointStrip snapshot={snapshot} />}
      <div data-testid="quant-symbol-console" className="rounded-xl border border-neutral/40 bg-surface-raised p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">量化条件查询</h2>
            <p className="mt-1 text-sm text-ink-muted">从量化监控池选择标的，查看生产口径的买入条件和历史事件统计。</p>
          </div>
          {onRefresh && <button type="button" onClick={onRefresh} disabled={loading} className="rounded-md bg-neutral/30 px-3 py-2 text-sm">{loading ? '读取中…' : '刷新快照'}</button>}
        </div>
        {snapshot && <p className="mt-2 text-xs tabular-nums text-ink-muted">{quantAnalysisFreshnessText(snapshot.generated_at)} · {REFRESH_CADENCE.quantAnalysis.interval}自动更新</p>}
        <div className="relative mt-4">
          <button
            type="button"
            aria-label="量化监控标的"
            aria-haspopup="listbox"
            aria-expanded={symbolMenuOpen}
            onClick={() => setSymbolMenuOpen((open) => !open)}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-neutral bg-transparent px-3 py-2 text-left"
          >
            <span className="min-w-0 truncate font-medium tabular-nums">{selectedSymbol}</span>
            <span className="ml-auto flex shrink-0 items-center gap-3">
              <span className={`font-semibold ${selectedSatisfied ? 'text-gain' : 'text-loss'}`}>
                {selectedSatisfied ? '满足' : '不满足'}
              </span>
              <span aria-hidden="true" className="text-ink-muted">{symbolMenuOpen ? '⌃' : '⌄'}</span>
            </span>
          </button>
          <div
            role="listbox"
            aria-label="量化监控标的列表"
            className={`${symbolMenuOpen ? 'absolute z-30 mt-1' : 'hidden'} max-h-80 w-full overflow-y-auto rounded-xl border border-neutral/50 bg-surface-raised p-1 shadow-xl`}
          >
            {monitoredSymbols.map((item) => {
              const satisfied = finalVerdictSatisfied(snapshot, item);
              return (
                <button
                  key={item}
                  type="button"
                  role="option"
                  aria-selected={item === selectedSymbol}
                  onClick={() => {
                    setSymbol(item);
                    setSymbolMenuOpen(false);
                  }}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-overlay"
                >
                  <span className="font-medium tabular-nums">{item}</span>
                  <span className={`font-semibold ${satisfied ? 'text-gain' : 'text-loss'}`}>
                    {satisfied ? '满足' : '不满足'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {snapshot && result?.found && (
          <SymbolVerdictCard
            snapshot={snapshot}
            symbol={result.symbol}
            allocation={allocation}
            embedded
          />
        )}
      </div>

      {error && <div className="rounded-xl border border-loss/40 bg-loss/10 p-3 text-sm text-loss">读取失败：{error}</div>}
      {!snapshot && !error && <div className="rounded-xl border border-neutral/40 bg-surface-raised p-4 text-sm text-ink-muted">{loading ? '正在读取量化系统快照…' : '暂无量化分析快照。'}</div>}

      {snapshot && isQuantAnalysisStale(snapshot.generated_at) && (
        <div className="rounded-xl border border-trim/40 bg-trim/10 p-3 text-sm tabular-nums text-trim">量化分析数据 {snapshotAgeHours === null ? '时间未知' : `${snapshotAgeHours} 小时前`}，可能过期。</div>
      )}

      {snapshot && result && !result.found && (
        <div className="rounded-xl border border-neutral/40 bg-surface-raised p-4">
          <div className="font-semibold">{result.symbol || '该代码'} 不在量化监控池，无判定数据</div>
          <div className="mt-2 text-sm text-ink-muted">池内代码：{result.monitoredSymbols.join('、')}</div>
        </div>
      )}

      {snapshot && result?.found && (
        <>
          <div id="buy-condition-detail" className="scroll-mt-4 rounded-xl border border-neutral/40 bg-surface-raised p-4">
            <div className="mb-4">
              {panicStatus?.applicable
                ? <PanicWindowStatus status={panicStatus} />
                : <DepthHighlight
                    analysis={result.analysis}
                    presentation={depthPresentation}
                    title={result.symbol === 'GDX' ? '黄金回撤买入窗口（GLD）' : '深度买入窗口（个股）'}
                    quotePrice={selectedDepthQuotePrice}
                    quote={selectedDepthQuote}
                  />}
            </div>
            <ValuationCard
              symbol={result.symbol}
              history={snapshot.pe_history ?? null}
              settings={valuationSettings}
              currentPrice={selectedDepthQuotePrice}
              priceSource={selectedDepthPriceSource}
              displayCurrency={displayCurrency}
              rates={rates}
            />
            {result.analysis.depth_window?.research && <FocusedDrawdownResearch research={result.analysis.depth_window.research} />}
            <div className="mt-4 border-t border-neutral/30 pt-4">
              <h3 className="font-semibold">回撤历史</h3>
              {!hasSignalStats && !hasDepthStats && (
                <p className="mt-2 text-sm text-ink-muted">当前没有可展示的历史事件样本。</p>
              )}
              {Object.entries(result.analysis.signal_stats || {}).map(([name, stats]) => (
                <div key={name} className="mt-3">
                  <div className="text-sm font-medium">{name}</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <StatWindow label="5 日" stat={stats.d5} />
                    <StatWindow label="20 日" stat={stats.d20} />
                    <StatWindow label="60 日" stat={stats.d60} />
                  </div>
                </div>
              ))}
              {result.analysis.depth_stats && <DepthStat stat={result.analysis.depth_stats} />}
              <p className="mt-3 text-xs font-medium text-trim">历史统计不代表未来收益；概率禁止相乘。</p>
            </div>
            {!result.analysis.available && (
              <p className="mt-3 text-trim">当前无可用判定：{result.analysis.error || '数据未生成'}</p>
            )}
          </div>

        </>
      )}
    </section>
  );
}
