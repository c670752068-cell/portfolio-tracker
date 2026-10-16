import type { DisplayCurrency, ExchangeRates, PortfolioMetrics, QuantAnalysisSnapshot, QuantPortfolioRisk, QuantSleeveMetric, QuantSleeveStatus } from '../types';
import { formatPct, formatSignedPct } from '../format';
import { formatDisplayMoney } from '../displayCurrency';
import { convertFromUsd } from '../displayCurrency';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import type { ValuePoint } from '../valueHistory';
import type { OneTapRefreshState } from '../oneTapRefresh';

interface SummaryProps {
  metrics: PortfolioMetrics;
  rates: ExchangeRates;
  displayCurrency: DisplayCurrency;
  onDisplayCurrencyChange: (currency: DisplayCurrency) => void;
  valueHistory: ValuePoint[];
  rateError: string;
  quoteStatus: {
    loading: boolean;
    lastSyncedAt: string | null;
    error: string;
    summary: string;
  };
  dayChangeStatusText?: string;
  canRefreshQuotes: boolean;
  onRefreshQuotes: () => void;
  exposureTargetPct: number;
  quantStatus: {
    loading: boolean;
    asOf: string | null;
    pushedAt: string | null;
    stale: boolean;
    error: string;
    summary: string;
  };
  quantSyncEnabled: boolean;
  quantGatewayAvailable: boolean;
  quantTokenConfigured: boolean;
  onRefreshQuant: () => void;
  oneTapRefreshState: OneTapRefreshState;
  canOneTapRefresh: boolean;
  oneTapCooldownSeconds: number;
  onOneTapRefresh: () => void;
  analysisSnapshot?: QuantAnalysisSnapshot | null;
}

export function Summary({ metrics, rates, displayCurrency, valueHistory, dayChangeStatusText, analysisSnapshot }: SummaryProps) {
  const dayClass =
    metrics.dayChange > 0 ? 'text-gain' : metrics.dayChange < 0 ? 'text-loss' : 'text-ink-secondary';
  const dayAccentClass =
    metrics.dayChange > 0 ? 'border-l-gain' : metrics.dayChange < 0 ? 'border-l-loss' : 'border-l-neutral';
  const trendPoints = valueHistory.slice(-30).map((point) => ({
    ...point,
    value: convertFromUsd(point.totalValueUsd, displayCurrency, rates),
  }));
  const trendStart = trendPoints[Math.max(0, trendPoints.length - 8)];
  const trendEnd = trendPoints.at(-1);
  const trendPct = trendStart && trendEnd && trendStart.totalValueUsd > 0
    ? trendEnd.totalValueUsd / trendStart.totalValueUsd - 1
    : 0;
  const trendClass = trendPct > 0 ? 'text-gain' : trendPct < 0 ? 'text-loss' : 'text-ink-secondary';
  const serverOptionItems = analysisSnapshot?.option_exposure?.items ?? [];
  const hasServerOptionExposure = serverOptionItems.length > 0;
  const serverOptionDeltaExposure = analysisSnapshot?.option_exposure?.delta_exposure_usd;
  const displayedOptionDeltaExposure = hasServerOptionExposure && Number.isFinite(serverOptionDeltaExposure)
    ? Math.abs(serverOptionDeltaExposure ?? 0)
    : metrics.optionDeltaExposure;
  const displayedEquivalentExposure = metrics.plainEquityExposure
    + metrics.leveragedEtfExposure
    + displayedOptionDeltaExposure;
  const displayedEquivalentExposurePct = metrics.totalValue > 0
    ? displayedEquivalentExposure / metrics.totalValue
    : 0;
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-4">
      <Card
        label={`总资产（${displayCurrency}）`}
        value={formatDisplayMoney(metrics.totalValue, displayCurrency, rates)}
        variant="hero"
        accentClass="border-l-neutral"
      >
        {trendPoints.length >= 2 && (
          <div className="mt-1.5 md:mt-1">
            <div className={`hidden h-10 w-full md:block ${trendClass}`} aria-label="近 30 天总资产趋势">
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 40 }}>
                <LineChart data={trendPoints}>
                  <Line type="monotone" dataKey="value" stroke="currentColor" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className={`text-[10px] tabular-nums md:text-[11px] ${trendClass}`}>
              {trendPoints.length >= 8 ? '近 7 天' : '记录以来'} {formatSignedPct(trendPct)}
            </div>
          </div>
        )}
      </Card>
      <Card
        label={`今日涨跌（${displayCurrency}）`}
        value={formatDisplayMoney(metrics.dayChange, displayCurrency, rates)}
        sub={formatSignedPct(metrics.dayChangePct)}
        valueClass={dayClass}
        subClass={dayClass}
        variant="hero"
        accentClass={dayAccentClass}
      >
        {dayChangeStatusText && (
          <div className="mt-1 text-[10px] leading-snug tabular-nums text-ink-secondary md:text-[11px] md:leading-relaxed">
            {dayChangeStatusText}
          </div>
        )}
      </Card>
      <Card
        label={`现金及等价物（${displayCurrency}）`}
        value={formatDisplayMoney(metrics.liquidityValue, displayCurrency, rates)}
        sub={`${formatPct(metrics.liquidityWeight)} · 现金 ${formatDisplayMoney(metrics.cashValue, displayCurrency, rates)} · 现金类 ETF ${formatDisplayMoney(metrics.cashEquivalentValue, displayCurrency, rates)}`}
      />
      {metrics.optionValue > 0 && (
        <Card label={`期权权利金（${displayCurrency}）`} value={formatDisplayMoney(metrics.optionValue, displayCurrency, rates)} sub={`${formatPct(metrics.optionWeight)} 的总资产`} />
      )}
      {metrics.holdingsMetrics.length > 0 && (
        <Card
          label={`等效正股暴露（${displayCurrency}）`}
          value={formatDisplayMoney(displayedEquivalentExposure, displayCurrency, rates)}
          sub={`等效仓位 ${formatPct(displayedEquivalentExposurePct)}`}
        />
      )}
      <OptionRiskDetails snapshot={analysisSnapshot} displayCurrency={displayCurrency} rates={rates} />
    </div>
  );
}

function OptionRiskDetails({ snapshot, displayCurrency, rates }: { snapshot?: QuantAnalysisSnapshot | null; displayCurrency: DisplayCurrency; rates: ExchangeRates }) {
  const options = snapshot?.option_exposure;
  if (!options) return null;
  const estimatedDelta = options?.items?.some(isEstimatedOptionDelta) ?? false;
  return (
    <details className="col-span-2 rounded-xl border border-neutral/50 bg-surface-raised p-3 md:col-span-4 md:rounded-2xl md:p-4">
      <summary className="cursor-pointer text-xs font-semibold text-ink-primary md:text-sm">期权风险专区 · Delta 敞口 {moneyOrUnavailable(options.delta_exposure_usd, displayCurrency, rates, estimatedDelta)}</summary>
      {estimatedDelta && <p className="mt-2 text-xs text-ink-muted">Delta 包含估算值，不是全部来自实时行情</p>}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:gap-3">
        <RiskMetric label="权利金" value={moneyOrUnavailable(options.premium_usd, displayCurrency, rates)} sub={options.premium_pct_of_nav !== undefined && options.premium_cap_pct !== undefined ? `${options.premium_pct_of_nav.toFixed(2)}% / 上限 ${options.premium_cap_pct.toFixed(2)}%` : '暂无'} tone={options.over_limit ? 'trim' : undefined} />
        {options.items?.map((item, index) => <RiskMetric key={`${item.symbol}-${index}`} label={`${item.symbol} · ${optionDeltaSourceLabel(item.delta_source)}`} value={moneyOrUnavailable(item.delta_notional_usd, displayCurrency, rates, isEstimatedOptionDelta(item))} sub={item.days_to_expiry === null || item.days_to_expiry === undefined ? '到期日暂无' : `距到期 ${item.days_to_expiry} 天`} tone={item.status === 'critical' ? 'trim' : undefined} />)}
      </div>
    </details>
  );
}

function isEstimatedOptionDelta(item: NonNullable<NonNullable<QuantPortfolioRisk['option_exposure']>['items']>[number]): boolean {
  if (item.data_quality === 'live_greeks') return false;
  return item.delta_source !== 'broker' && item.delta_source !== 'opend';
}

function optionDeltaSourceLabel(source?: string): string {
  if (source === 'broker') return '券商 Delta';
  if (source === 'opend') return 'OpenD 实时 Delta';
  return '估算 Delta';
}

function RiskMetric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'trim' }) {
  return <div className="min-w-0 rounded-lg border border-neutral/35 bg-surface-overlay/60 p-2 md:rounded-xl md:p-3"><div className="text-[10px] text-ink-secondary md:text-xs">{label}</div><div className={`mt-1 break-words text-sm font-semibold tabular-nums md:text-lg ${tone === 'trim' ? 'text-trim' : 'text-ink-primary'}`}>{value}</div><div className="mt-1 text-[9px] leading-snug tabular-nums text-ink-secondary md:text-[11px]">{sub}</div></div>;
}

function moneyOrUnavailable(value: number | undefined, displayCurrency: DisplayCurrency, rates: ExchangeRates, approximate = false): string {
  if (value === undefined || !Number.isFinite(value)) return '暂无';
  return `${approximate ? '≈' : ''}${formatDisplayMoney(value, displayCurrency, rates)}`;
}

type SleeveBasis = 'effective' | 'cash';
export type SleeveDisplayBasis = 'both' | SleeveBasis;
type SleeveMetricEntry = readonly [SleeveBasis, QuantSleeveMetric | undefined];

/**
 * The server owns both sleeve measurements.  This selector only chooses which
 * already-provided measurement may be visible in a given display mode.
 */
function selectSleevePresentation(row: QuantSleeveStatus, displayBasis: SleeveDisplayBasis): {
  visibleMetrics: SleeveMetricEntry[];
  note?: string;
} {
  const visibleMetrics: SleeveMetricEntry[] = displayBasis === 'both'
    ? [['effective', row.effective], ['cash', row.cash]]
    : displayBasis === 'effective'
      ? [['effective', row.effective]]
      : [['cash', row.cash]];
  // A basis-specific note always wins.  Only when the server omits one does the
  // row-level conclusion stand in, so switching basis never drops the verdict.
  const note = displayBasis === 'both'
    ? row.note
    : visibleMetrics[0]?.[1]?.note ?? row.note;
  return { visibleMetrics, note };
}

export function SleeveBar({ name, row, displayBasis }: { name: string; row: QuantSleeveStatus; displayBasis: SleeveDisplayBasis }) {
  const labels: Record<string, string> = { tech: '科技', options: '期权', broad_dow: '宽基+道指', other: '其他' };
  const label = labels[name] ?? name;
  const isUnlimited = Boolean(row.unlimited);
  const target = row.baseline_pct ?? row.target_pct;
  const hardCap = row.hard_cap_pct ?? null;
  const effective = row.effective;
  const cash = row.cash;
  const { visibleMetrics, note } = selectSleevePresentation(row, displayBasis);
  const hardCapBases = visibleMetrics.filter(([, metric]) => metric?.zone === 'over_hard_cap').map(([basis]) => basis);
  const displayMetric = visibleMetrics.find(([, metric]) => metric?.zone === 'over_hard_cap')?.[1]
    ?? visibleMetrics.find(([, metric]) => metric)?.[1];
  const displayZone = displayMetric?.zone ?? 'unknown';
  const hardCapLabel = hardCapBases.length === 2 ? '双' : hardCapBases[0] === 'cash' ? '现金' : hardCapBases[0] === 'effective' ? '等效' : '';
  const status = isUnlimited
    ? '不限'
    : displayZone === 'over_hard_cap'
    ? `超硬顶${hardCapLabel ? `(${hardCapLabel})` : ''}`
    : displayZone === 'borrowing'
      ? `借用中${displayBasis === 'both' ? '' : `(${displayBasis === 'cash' ? '现金' : '等效'})`}`
      : displayZone === 'on_target'
        ? '在基准内'
        : displayZone === 'empty'
          ? '待补'
          : displayZone === 'under'
            ? '低于基准'
            : '暂无';
  const statusClass = displayZone === 'over_hard_cap'
    ? 'bg-loss/10 text-loss'
    : displayZone === 'borrowing'
      ? 'bg-trim/10 text-trim'
      : 'bg-neutral/25 text-ink-secondary';
  const metricName = (basis: 'effective' | 'cash') => basis === 'effective' ? '等效' : '现金';
  const metricClass = (metric: typeof effective) => metric?.zone === 'over_hard_cap'
    ? 'bg-loss'
    : metric?.zone === 'borrowing'
      ? 'bg-trim'
      : metric?.zone === 'on_target'
        ? 'bg-buy'
        : 'bg-cash';
  const metricLine = (basis: 'effective' | 'cash', metric: typeof effective) => {
    if (!metric) return null;
    const facts = [
      metric.over_baseline_usd && metric.over_baseline_usd > 0 ? `超基准 $${metric.over_baseline_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : null,
      metric.over_hard_cap_usd && metric.over_hard_cap_usd > 0 ? `超硬顶 $${metric.over_hard_cap_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : null,
      metric.zone !== 'over_hard_cap' && metric.gap_usd && metric.gap_usd > 0 ? `缺口 $${metric.gap_usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : null,
    ].filter(Boolean);
    return facts.length > 0 ? <p className="mt-1 text-[10px] leading-relaxed tabular-nums text-ink-secondary">{metricName(basis)}：{facts.join(' · ')}</p> : null;
  };
  const isDualBasis = displayBasis === 'both';
  const selectedBasis = isDualBasis ? null : visibleMetrics[0]?.[0];
  const selectedMetric = isDualBasis ? undefined : visibleMetrics[0]?.[1];
  // 65/5/25/5 is a share-of-portfolio baseline, so it applies to whichever basis
  // is on screen.  Showing it beats "目标暂无" when the server sent no
  // basis-specific target for this sleeve.
  const sharedGuide = isUnlimited
    ? '不设上限'
    : `${target === undefined ? '基准暂无' : `基准 ${target.toFixed(2)}%`}${hardCap !== null ? ` · 硬顶 ${hardCap.toFixed(2)}%` : ''}`;
  const headerGuide = isDualBasis
    ? sharedGuide
    : selectedBasis && selectedMetric?.available_target_pct !== undefined
      ? `${metricName(selectedBasis)}目标 ${selectedMetric.available_target_pct.toFixed(2)}%`
      : sharedGuide;
  const sharedTargetMarker = !isUnlimited && isDualBasis && target !== undefined
    ? <span className="absolute inset-y-0 w-px bg-ink-primary/70" style={{ left: progressWidth(target) }} title={`基准 ${target.toFixed(2)}%`} />
    : null;
  const sharedHardCapMarker = !isUnlimited && isDualBasis && hardCap !== null
    ? <span className="absolute inset-y-0 w-px bg-loss/90" style={{ left: progressWidth(hardCap) }} title={`硬顶 ${hardCap.toFixed(2)}%`} />
    : null;
  const metricTargetMarker = (basis: SleeveBasis, metric: QuantSleeveMetric | undefined, className: string) => metric?.available_target_pct === undefined
    ? null
    : <span data-sleeve-target={basis} className={`absolute left-0 w-px border-l border-dashed ${basis === 'cash' ? 'border-cash' : 'border-trim/90'} ${className}`} style={{ left: progressWidth(metric.available_target_pct) }} title={`${metricName(basis)}目标 ${metric.available_target_pct.toFixed(2)}%`} />;
  const targetHint = (basis: 'effective' | 'cash', metric: typeof effective) => metric?.available_target_pct === undefined
    ? null
    : <span className={basis === 'cash' ? 'text-cash' : 'text-trim'}>↑ {metricName(basis)}目标 {metric.available_target_pct.toFixed(0)}%</span>;
  const hasVisibleBlock = visibleMetrics.some(([, metric]) => metric?.block_new_buy);
  const noteClass = hasVisibleBlock || displayZone === 'over_hard_cap' ? 'text-loss' : 'text-ink-secondary';
  const borrowedPp = (basis: SleeveBasis, metric: QuantSleeveMetric | undefined) => basis === 'effective'
    ? row.borrowed_pp
    : row.cash_borrowed_pp ?? metric?.borrowed_pp;
  const borrowFootnote = isUnlimited
    ? ''
    : name === 'tech'
    ? visibleMetrics.flatMap(([basis, metric]) => {
      const used = borrowedPp(basis, metric);
      return used === undefined ? [] : [`${displayBasis === 'both' ? `${metricName(basis)} ` : ''}已使用借额 ${used.toFixed(2)}pp`];
    }).join(' · ')
    : name === 'broad_dow'
      ? (() => {
        const basisSpecific = visibleMetrics.flatMap(([basis, metric]) => metric?.lent_pp === undefined
          ? []
          : [`${displayBasis === 'both' ? `${metricName(basis)} ` : ''}已被科技借走 ${metric.lent_pp.toFixed(2)}pp`]);
        if (basisSpecific.length > 0) return basisSpecific.join(' · ');
        // The legacy row-level value describes the dual-basis summary only.
        // Never project it into a single-basis card, where it could be an
        // effective-exposure value shown while the user selected cash.
        return displayBasis === 'both' && row.lent_pp !== undefined
          ? `已被科技借走 ${row.lent_pp.toFixed(2)}pp`
          : '';
      })()
      : '';
  return <div className="min-w-0 rounded-xl border border-neutral/25 bg-surface-overlay/35 p-3">
    <div className="flex min-w-0 flex-col gap-1 text-xs sm:flex-row sm:items-start sm:justify-between sm:gap-2"><div className="min-w-0"><span className="font-medium text-ink-primary">{label}</span><span className={`ml-2 inline-block rounded-full px-1.5 py-0.5 text-[10px] ${statusClass}`}>{status}</span></div><span className="max-w-full break-words tabular-nums text-ink-secondary">{headerGuide}</span></div>
    {note && <p className={`mt-2 break-words text-sm leading-relaxed ${noteClass}`}>{note}</p>}
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums">
      {displayBasis !== 'cash' && <span className="text-ink-primary">等效 {effective?.pct === undefined ? '暂无' : `${effective.pct.toFixed(2)}%`}</span>}
      {displayBasis !== 'effective' && <span className="text-cash">现金 {cash?.pct === undefined ? '暂无' : `${cash.pct.toFixed(2)}%`}</span>}
    </div>
    <div className="relative mt-2 h-5 overflow-hidden rounded-full border border-neutral/30 bg-surface-base" aria-label={`${label} ${displayBasis === 'both' ? '双口径' : displayBasis === 'cash' ? '现金' : '等效'}进度条`}>
      {isDualBasis && hardCap !== null && target !== undefined && hardCap > target && <div className="absolute inset-y-0 bg-trim/12" style={{ left: progressWidth(target), width: `${Math.max(0, Math.min(100, hardCap) - Math.min(100, target))}%` }} />}
      {displayBasis !== 'effective' && cash && <SleeveTrackFill basis="cash" metric={cash} hardCap={hardCap} className="bottom-0 h-1.5" metricClass={metricClass(cash)} />}
      {displayBasis !== 'cash' && effective && <SleeveTrackFill basis="effective" metric={effective} hardCap={hardCap} className="top-0 h-2.5" metricClass={metricClass(effective)} />}
      {displayBasis !== 'effective' && metricTargetMarker('cash', cash, 'bottom-0 h-1.5')}
      {displayBasis !== 'cash' && metricTargetMarker('effective', effective, 'top-0 h-2.5')}
      {sharedTargetMarker}{sharedHardCapMarker}
    </div>
    {!isUnlimited && <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] tabular-nums text-ink-muted">{isDualBasis && <span>{target === undefined ? '基准暂无' : `↑ 基准 ${target.toFixed(0)}%`}</span>}{isDualBasis && hardCap !== null && <span className="text-loss">↑ 硬顶 {hardCap.toFixed(0)}%</span>}{displayBasis !== 'cash' && targetHint('effective', effective)}{displayBasis !== 'effective' && targetHint('cash', cash)}</div>}
    <details className="mt-2 text-xs"><summary className="cursor-pointer text-ink-muted">{displayBasis === 'both' ? '查看双口径明细' : '查看本口径明细'}</summary><div className="mt-2">{displayBasis !== 'cash' && metricLine('effective', effective)}{displayBasis !== 'effective' && metricLine('cash', cash)}</div></details>
    {name === 'options' && <p className="mt-2 text-[11px] text-trim">禁区，不可借</p>}
    {borrowFootnote && <p className="mt-2 break-words text-[11px] text-trim">{borrowFootnote}{name === 'tech' && displayBasis !== 'cash' ? ` · 剩余 ${row.borrow_room_pp?.toFixed(2) ?? '暂无'}pp` : ''}</p>}
  </div>;
}

function SleeveTrackFill({ basis, metric, hardCap, className, metricClass }: { basis: SleeveBasis; metric: QuantSleeveMetric; hardCap: number | null; className: string; metricClass: string }) {
  const pct = Math.max(0, Math.min(100, metric.pct ?? 0));
  const isOverHardCap = metric.zone === 'over_hard_cap' && hardCap !== null;
  const withinCap = isOverHardCap ? Math.min(pct, Math.max(0, hardCap)) : pct;
  const beyondCap = isOverHardCap ? Math.max(0, pct - withinCap) : 0;
  return <>
    <span data-sleeve-fill={basis} className={`absolute left-0 ${className} ${metricClass} transition-[width] duration-200 ease-out motion-reduce:transition-none`} style={{ width: progressWidth(withinCap) }} />
    {beyondCap > 0 && <span data-sleeve-overage={basis} className={`sleeve-over-hard-cap absolute ${className} transition-[width] duration-200 ease-out motion-reduce:transition-none`} style={{ left: progressWidth(withinCap), width: progressWidth(beyondCap) }} />}
  </>;
}

function progressWidth(value: number | undefined): string {
  return `${Math.max(0, Math.min(100, value ?? 0))}%`;
}

interface CardProps {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
  subClass?: string;
  variant?: 'standard' | 'hero';
  accentClass?: string;
  children?: React.ReactNode;
}

function Card({ label, value, sub, valueClass, subClass, variant = 'standard', accentClass = 'border-l-neutral', children }: CardProps) {
  const isHero = variant === 'hero';
  return (
    <div className={`min-w-0 ${isHero ? `elev-2 rounded-xl border border-neutral/60 border-l-2 p-2.5 md:col-span-2 md:rounded-2xl md:border-l-4 md:p-6 ${accentClass}` : 'elev-2 rounded-xl border border-neutral/40 p-2.5 md:rounded-2xl md:p-4'} bg-surface-raised`}>
      <div className={`${isHero ? 'text-[10px] font-medium md:text-sm' : 'text-[10px] md:text-xs'} text-ink-secondary`}>{label}</div>
      <div className={`text-display mt-1 break-words font-semibold leading-none tabular-nums md:mt-2 ${isHero ? 'text-xl md:text-4xl' : 'text-[1.05rem] md:text-xl'} ${valueClass ?? ''}`}>{value}</div>
      {sub && <div className={`mt-1 tabular-nums md:mt-2 ${isHero ? 'text-[10px] md:text-sm' : 'text-[10px] leading-snug md:text-xs'} ${subClass ?? 'text-ink-secondary'}`}>{sub}</div>}
      {children}
    </div>
  );
}
