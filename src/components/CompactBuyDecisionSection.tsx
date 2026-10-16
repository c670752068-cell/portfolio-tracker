import { useMemo, useState } from 'react';
import { CASH_EQUIVALENT_SYMBOLS } from '../assetClass';
import { buildCompactBuyDecision } from '../compactBuyDecision';
import { REFRESH_CADENCE } from '../refreshCadence';
import { isQuantAnalysisStale, quantAnalysisAgeHours, quantAnalysisFreshnessText } from '../quantAnalysis';
import type { OneTapRefreshState } from '../oneTapRefresh';
import type { QuantAnalysisSnapshot } from '../types';

interface Props {
  snapshot: QuantAnalysisSnapshot | null;
  initialSymbol?: string;
  loading?: boolean;
  error?: string;
  onRefresh?: () => void;
  refreshState?: OneTapRefreshState;
  cooldownSeconds?: number;
}

export function CompactBuyDecisionSection({
  snapshot,
  initialSymbol = 'TQQQ',
  loading = false,
  error = '',
  onRefresh,
  refreshState = { phase: 'idle', message: '' },
  cooldownSeconds = 0,
}: Props) {
  const monitoredSymbols = useMemo(() => {
    if (!snapshot) return [];
    const growth = snapshot.growth_watchlist?.active_symbols ?? [];
    const source = growth.length > 0 ? growth : Object.keys(snapshot.symbols);
    return [...new Set(source)]
      .filter((symbol) => Boolean(snapshot.symbols[symbol]))
      .filter((symbol) => !CASH_EQUIVALENT_SYMBOLS.has(symbol.toUpperCase()))
      .sort((left, right) => {
        const leftDecision = buildCompactBuyDecision(snapshot, left);
        const rightDecision = buildCompactBuyDecision(snapshot, right);
        return Number(rightDecision.ready) - Number(leftDecision.ready)
          || rightDecision.excessPct - leftDecision.excessPct
          || slopeSortValue(rightDecision.maSlope) - slopeSortValue(leftDecision.maSlope)
          || left.localeCompare(right);
      });
  }, [snapshot]);
  const requested = initialSymbol.toUpperCase();
  const firstSymbol = monitoredSymbols.includes(requested) ? requested : monitoredSymbols[0] || '';
  const [symbol, setSymbol] = useState(firstSymbol);
  const [menuOpen, setMenuOpen] = useState(false);
  const selectedSymbol = monitoredSymbols.includes(symbol) ? symbol : firstSymbol;
  const decision = snapshot && selectedSymbol ? buildCompactBuyDecision(snapshot, selectedSymbol) : null;
  const ageHours = snapshot ? quantAnalysisAgeHours(snapshot.generated_at) : null;
  const refreshBusy = loading || ['requested', 'throttled', 'waiting'].includes(refreshState.phase);

  return (
    <section data-testid="compact-buy-decision" className="rounded-2xl border border-neutral/40 bg-surface-raised p-3 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold sm:text-lg">买入条件</h2>
          <p className="mt-0.5 text-xs text-ink-muted sm:mt-1 sm:text-sm">只按回撤判断买入；回撤越深，买入优先级越高。</p>
        </div>
        {onRefresh && (
          <button type="button" onClick={onRefresh} disabled={refreshBusy} className="min-h-11 rounded-lg bg-neutral/25 px-3 text-xs sm:py-2 sm:text-sm">
            {refreshBusy ? '刷新中…' : cooldownSeconds > 0 ? `${cooldownSeconds}s` : '刷新'}
          </button>
        )}
      </div>
      {refreshState.message && (
        <p className={`mt-1 text-[10px] sm:text-xs ${refreshState.phase === 'error' || refreshState.phase === 'timeout' ? 'text-loss' : refreshState.phase === 'done' ? 'text-gain' : 'text-ink-muted'}`}>
          {refreshState.message}
        </p>
      )}
      {snapshot && <p className="mt-1 text-[10px] tabular-nums text-ink-muted sm:mt-2 sm:text-xs">{quantAnalysisFreshnessText(snapshot.generated_at)} · {REFRESH_CADENCE.quantAnalysis.interval}自动更新</p>}

      {snapshot && (snapshot.growth_watchlist?.unresolved?.length ?? 0) > 0 && (
        <div className="mt-3 rounded-xl border border-trim/35 bg-trim/10 px-3 py-2 text-sm text-trim">
          成长股待判断：{snapshot.growth_watchlist?.unresolved?.map((item) => item.symbol).join('、')}；需要时请让 Codex 判断。
        </div>
      )}

      {error && <div className="mt-4 rounded-xl border border-loss/40 bg-loss/10 p-3 text-sm text-loss">读取失败：{error}</div>}
      {!snapshot && !error && <div className="mt-4 text-sm text-ink-muted">{loading ? '正在读取量化快照…' : '暂无量化快照。'}</div>}

      {snapshot && (
        <>
          <div className="relative mt-2 sm:mt-4">
            <button
              type="button"
              aria-label="买入判定标的"
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-neutral/50 bg-surface-overlay/35 px-3 py-1.5 text-left sm:min-h-12 sm:py-2"
            >
              <span className="font-semibold tabular-nums">{selectedSymbol}</span>
              <span className={`ml-auto font-semibold ${statusTextClass(decision?.label)}`}>{decision?.label ?? '数据不足'}</span>
              <span aria-hidden="true" className="text-ink-muted">{menuOpen ? '⌃' : '⌄'}</span>
            </button>
            <div role="listbox" aria-label="买入判定标的列表" className={`${menuOpen ? 'absolute z-30 mt-1' : 'hidden'} max-h-80 w-full overflow-y-auto rounded-xl border border-neutral/50 bg-surface-raised p-1 shadow-xl`}>
              {monitoredSymbols.map((item) => {
                const itemDecision = buildCompactBuyDecision(snapshot, item);
                return (
                  <button
                    key={item}
                    type="button"
                    role="option"
                    aria-selected={item === selectedSymbol}
                    onClick={() => { setSymbol(item); setMenuOpen(false); }}
                    className="flex min-h-11 w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-surface-overlay"
                  >
                    <span className="font-medium tabular-nums">{item}</span>
                    <span className={`font-semibold ${statusTextClass(itemDecision.label)}`}>{itemDecision.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {decision && <DecisionBody decision={decision} />}

          {isQuantAnalysisStale(snapshot.generated_at) && (
            <p className="mt-3 text-xs tabular-nums text-trim">数据 {ageHours === null ? '时间未知' : `${ageHours} 小时前`}，请先刷新。</p>
          )}
        </>
      )}
    </section>
  );
}

function DecisionBody({ decision }: { decision: ReturnType<typeof buildCompactBuyDecision> }) {
  const stateClass = decision.ready
    ? 'border-gain/45 bg-gain/10'
    : decision.label === '数据不足'
      ? 'border-trim/40 bg-trim/10'
      : 'border-loss/35 bg-loss/8';
  const executionQualifier = decision.historicalSampleStatus === 'reference'
    ? '（参考）'
    : decision.historicalSampleStatus === 'insufficient' && decision.executionAvailable
      ? '（小样本参考）'
      : '';
  return (
    <div className={`mt-2 rounded-xl border p-3 sm:mt-4 sm:p-4 ${stateClass}`}>
      <div className="flex items-start gap-2 sm:flex-wrap sm:items-center sm:gap-3">
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold sm:px-3 sm:py-1 sm:text-sm ${decision.ready ? 'bg-gain text-white' : decision.label === '数据不足' ? 'bg-trim text-white' : 'bg-loss text-white'}`}>{decision.label}</span>
        <strong className="pt-0.5 text-sm leading-snug sm:pt-0 sm:text-lg">{decision.message}</strong>
      </div>
      <div data-testid="mobile-buy-summary" className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:hidden">
        <div className="rounded-lg bg-surface-raised/75 p-2">
          <div className="text-ink-muted">当前回撤 / 回撤线</div>
          <div className="mt-0.5 font-semibold tabular-nums">
            {percent(decision.currentDrawdownPct)} / {percent(decision.thresholdPct)}
          </div>
        </div>
        <div className="rounded-lg bg-surface-raised/75 p-2">
          <div className="text-ink-muted">高点 / 回撤达标价</div>
          <div className="mt-0.5 font-semibold tabular-nums">
            {decision.highPrice !== null ? money(decision.highPrice) : '暂无'} / {decision.targetPrice !== null ? money(decision.targetPrice) : '暂无'}
          </div>
        </div>
      </div>
      <div className="mt-4 hidden gap-2 sm:grid sm:grid-cols-2">
        <div className="rounded-lg bg-surface-raised/75 p-3 text-sm">
          <div className="text-xs text-ink-muted">历史统计线（{decision.historicalBasisSymbol} · 2021–2026）</div>
          <div className="mt-1 font-semibold tabular-nums">
            中位 {percent(decision.historicalMedianPct)} · 平均 {percent(decision.historicalAveragePct)} · n={decision.historicalSampleCount}
            {decision.historicalSampleStatus === 'reference' ? ' · 参考' : ''}
          </div>
        </div>
        <div className="rounded-lg bg-surface-raised/75 p-3 text-sm">
          <div className="text-xs text-ink-muted">实际执行线{executionQualifier}</div>
          <div className={`mt-1 font-semibold ${decision.executionAvailable ? 'text-ink' : 'text-loss'}`}>
            {decision.executionAvailable
              ? `${decision.priceLabel} 当前回撤 ${percent(decision.currentDrawdownPct)} · 回撤线 ${percent(decision.thresholdPct)}`
              : '样本不足，待判断'}
          </div>
          {decision.highPrice !== null && (
            <div className="mt-1 text-xs tabular-nums text-ink-muted">
              计算高点 {money(decision.highPrice)}（最高收盘价{decision.highPriceDate ? ` · ${decision.highPriceDate}` : ''}）
            </div>
          )}
          {!decision.ready && decision.executionAvailable && decision.gapPct !== null && decision.gapPct > 0 && (
            <div className="mt-1 text-xs font-medium tabular-nums text-loss">还需下跌 {decision.gapPct.toFixed(2)} 个百分点</div>
          )}
        </div>
      </div>
      <SlopeContext symbol={decision.symbol} slope={decision.maSlope} />
      <div className="mt-2 text-[10px] text-ink-muted sm:text-xs">估值不参与买入判断 · 均线仅作执行参考</div>
      {(decision.currentPrice !== null || decision.targetPrice !== null) && (
        <div className="mt-3 hidden text-xs tabular-nums text-ink-secondary sm:block">
          {decision.priceLabel} {decision.currentPrice !== null ? `当前参考价 ${money(decision.currentPrice)}` : ''}
          {decision.targetPrice !== null ? ` · 回撤达标价 ${money(decision.targetPrice)}（仅表示价格条件；达到后回撤越深，买入优先级越高）` : ''}
        </div>
      )}
    </div>
  );
}

function SlopeContext({
  symbol,
  slope,
}: {
  symbol: string;
  slope: ReturnType<typeof buildCompactBuyDecision>['maSlope'];
}) {
  if (!slope) return null;
  if (!slope.available || slope.annualized_pct === null) {
    return (
      <div className="mt-3 rounded-lg border border-neutral/40 bg-surface-raised/65 p-3 text-xs text-ink-muted">
        <div className="font-semibold text-ink-secondary">200日均线斜率（20个交易日变化 · 252日年化）</div>
        <div className="mt-1">{slope.reason}</div>
        <div className="mt-1">斜率仅作趋势风险说明；回撤仍优先。</div>
      </div>
    );
  }
  const trendClass = slope.direction === 'up' ? 'text-gain' : 'text-loss';
  return (
    <div data-testid="ma-slope-context" className="mt-3 rounded-lg border border-neutral/40 bg-surface-raised/65 p-3 text-xs">
      <div className="text-ink-muted">200日均线斜率（20个交易日变化 · 252日年化）</div>
      <div className={`mt-1 text-sm font-semibold tabular-nums ${trendClass}`}>
        {signedPercent(slope.annualized_pct)} · {slope.label}
      </div>
      <div className="mt-1 tabular-nums text-ink-secondary">
        {symbol} 当前200DMA {slope.current_ma === null ? '暂无' : money(slope.current_ma)} · 20日前 {slope.comparison_ma === null ? '暂无' : money(slope.comparison_ma)}
        {slope.as_of ? ` · ${slope.as_of}` : ''}
      </div>
      <div className="mt-1 text-ink-muted">只作趋势风险说明，不参与“可以买/不买”否决；回撤仍优先。</div>
    </div>
  );
}

function statusTextClass(label: ReturnType<typeof buildCompactBuyDecision>['label'] | undefined): string {
  if (label === '可以买') return 'text-gain';
  if (label === '数据不足') return 'text-trim';
  return 'text-loss';
}

function percent(value: number | null): string {
  return value === null ? '暂无' : `${value.toFixed(2)}%`;
}

function money(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function slopeSortValue(slope: ReturnType<typeof buildCompactBuyDecision>['maSlope']): number {
  return slope?.available && typeof slope.annualized_pct === 'number'
    ? slope.annualized_pct
    : Number.NEGATIVE_INFINITY;
}
