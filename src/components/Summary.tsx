import type { DisplayCurrency, ExchangeRates, PortfolioMetrics, QuantAnalysisSnapshot, QuantPortfolioRisk, QuantSleeveMetric, QuantSleeveStatus } from '../types';
import { formatPct, formatSignedPct } from '../format';
import { formatDisplayMoney } from '../displayCurrency';
import { convertFromUsd } from '../displayCurrency';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import type { ValuePoint } from '../valueHistory';
import type { OneTapRefreshState } from '../oneTapRefresh';
import { useState } from 'react';
import { REFRESH_CADENCE } from '../refreshCadence';

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

export function Summary({ metrics, rates, displayCurrency, onDisplayCurrencyChange, valueHistory, rateError, quoteStatus, dayChangeStatusText, canRefreshQuotes, onRefreshQuotes, exposureTargetPct, quantStatus, quantSyncEnabled, quantGatewayAvailable, quantTokenConfigured, onRefreshQuant, oneTapRefreshState, canOneTapRefresh, oneTapCooldownSeconds, onOneTapRefresh, analysisSnapshot }: SummaryProps) {
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
  const oneTapBusy = oneTapRefreshState.phase === 'requested'
    || oneTapRefreshState.phase === 'throttled'
    || oneTapRefreshState.phase === 'waiting';
  const oneTapUnavailableReason = !quantGatewayAvailable
    ? '一键刷新仅在 VPS 入口可用'
    : !quantSyncEnabled
      ? '量化同步未启用'
      : !quantTokenConfigured
        ? '请先在设置填写同步 Token'
        : '';
  const completedTime = oneTapRefreshState.completedAt
    ? new Date(oneTapRefreshState.completedAt).toLocaleTimeString('zh-CN', { hour12: false })
    : '';
  const oneTapButtonLabel = oneTapBusy
    ? oneTapRefreshState.message
    : oneTapRefreshState.phase === 'done' && completedTime
      ? `已更新（${completedTime}）`
      : '一键刷新全部';
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      <Card
        label={`总资产（${displayCurrency}）`}
        value={formatDisplayMoney(metrics.totalValue, displayCurrency, rates)}
        variant="hero"
        accentClass="border-l-neutral"
      >
        {trendPoints.length >= 2 && (
          <div className="mt-1">
            <div className={`h-10 w-full ${trendClass}`} aria-label="近 30 天总资产趋势">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendPoints}>
                  <Line type="monotone" dataKey="value" stroke="currentColor" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className={`font-mono text-[11px] tabular-nums ${trendClass}`}>
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
          <div className="mt-1 font-mono text-[11px] leading-relaxed tabular-nums text-ink-secondary">
            {dayChangeStatusText}
          </div>
        )}
      </Card>
      <div className="rounded-2xl border border-neutral/50 border-l-4 border-l-buy bg-surface-raised p-4 md:col-span-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-ink-primary">刷新</div>
            <div className="mt-1 text-xs leading-relaxed text-ink-secondary">
              {oneTapUnavailableReason || oneTapRefreshState.message || '重新读取行情、持仓和分析，并请求量化系统立即重算。'}
            </div>
            {oneTapCooldownSeconds > 0 && (
              <div className="mt-1 font-mono text-xs tabular-nums text-trim">
                {oneTapCooldownSeconds} 秒后可再次刷新
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onOneTapRefresh}
            disabled={!canOneTapRefresh || oneTapBusy || oneTapCooldownSeconds > 0}
            className="min-h-11 w-full rounded-xl bg-buy px-4 py-2 font-mono text-sm font-semibold tabular-nums text-surface-base hover:bg-buy/85 disabled:cursor-not-allowed disabled:bg-neutral disabled:text-ink-muted sm:w-auto sm:min-w-40"
          >
            {oneTapButtonLabel}
          </button>
        </div>
        <div className="mt-2 text-[11px] leading-relaxed text-ink-secondary">
          刷新会让量化系统重新检查一次，若有符合条件的标的会照常推送到手机
        </div>
      </div>
      <Card
        label={`持仓市值（${displayCurrency}）`}
        value={formatDisplayMoney(metrics.equityValue, displayCurrency, rates)}
        sub={`${formatPct(1 - metrics.cashWeight)}（含现金类 ETF ${formatDisplayMoney(metrics.cashEquivalentValue, displayCurrency, rates)}）`}
      />
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
          value={formatDisplayMoney(metrics.equivalentExposureTotal, displayCurrency, rates)}
          sub={`等效仓位 ${formatPct(metrics.equivalentExposurePct)} · 目标 ${exposureTargetPct}%`}
        >
          <div className="mt-1 font-mono text-[11px] leading-relaxed tabular-nums text-ink-secondary">
            正股 {formatDisplayMoney(metrics.plainEquityExposure, displayCurrency, rates)} · 杠杆折算 {formatDisplayMoney(metrics.leveragedEtfExposure, displayCurrency, rates)} · 期权Δ {formatDisplayMoney(metrics.optionDeltaExposure, displayCurrency, rates)}
          </div>
          <div className="mt-1 text-[11px] text-ink-secondary">网站口径：仅真实 Delta；缺失项未计入，见下方期权风险专区的 0.5 假设口径</div>
          {metrics.uncomputableOptions > 0 && (
            <div className="mt-1 font-mono text-[11px] tabular-nums text-trim">
              ⚠ {metrics.uncomputableOptions} 个期权缺 Delta/标的价未计入（用「补充期权详情」导入）
            </div>
          )}
        </Card>
      )}
      <RiskOverview snapshot={analysisSnapshot} displayCurrency={displayCurrency} rates={rates} />
      <div className="rounded-2xl border border-neutral/40 bg-surface-raised p-4 text-xs md:col-span-4">
        <label className="font-medium text-ink-primary">
          显示货币：
          <select
            aria-label="显示货币"
            value={displayCurrency}
            onChange={(event) => onDisplayCurrencyChange(event.target.value as DisplayCurrency)}
            className="ml-1 rounded border border-neutral bg-surface-overlay px-2 py-1 font-mono text-xs tabular-nums text-ink-primary"
          >
            {(['USD', 'CNY', 'HKD', 'JPY', 'EUR', 'GBP'] as DisplayCurrency[]).map((currency) => (
              <option key={currency} value={currency}>{currency}</option>
            ))}
          </select>
        </label>
        <span className="ml-3 font-mono tabular-nums text-ink-secondary">1 USD ≈ {rates.CNY.toFixed(4)} CNY</span>
        <span className="ml-2 font-mono tabular-nums text-ink-muted">{rates.source === 'live' ? `实时数据 ${rates.updatedAt ?? ''}` : rates.source === 'cache' ? `缓存数据 ${rates.updatedAt ?? ''}` : '近似兜底值'}</span>
        {rateError && <span className="ml-2 text-trim">{rateError}</span>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral/40 bg-surface-raised p-4 text-xs md:col-span-4">
        <div>
          <span className="font-medium text-ink-primary">行情同步：</span>
          <span className="font-mono tabular-nums text-ink-secondary">
            {quoteStatus.loading ? '正在刷新…' : quoteStatus.summary || (canRefreshQuotes ? `${REFRESH_CADENCE.quotes.interval}自动刷新` : '未配置行情源')}
          </span>
          {quoteStatus.lastSyncedAt && <span className="ml-2 font-mono tabular-nums text-ink-muted">{new Date(quoteStatus.lastSyncedAt).toLocaleString()}</span>}
          {quoteStatus.error && <span className="ml-2 text-trim">{quoteStatus.error}</span>}
        </div>
        <button
          type="button"
          onClick={onRefreshQuotes}
          disabled={quoteStatus.loading || !canRefreshQuotes}
          className="min-h-11 rounded-xl bg-buy/15 px-4 py-2 text-xs font-medium text-buy hover:bg-buy/25 disabled:cursor-not-allowed disabled:bg-neutral disabled:text-ink-muted"
        >
          {quoteStatus.loading ? '刷新中' : '手动刷新'}
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral/40 bg-surface-raised p-4 text-xs md:col-span-4">
        <div className="min-w-0">
          <span className="font-medium text-ink-primary">量化系统同步：</span>
          {!quantGatewayAvailable ? (
            <span className="text-trim">量化同步仅在 VPS 入口可用</span>
          ) : !quantSyncEnabled ? (
            <span className="text-ink-secondary">未启用</span>
          ) : !quantTokenConfigured ? (
            <span className="text-trim">未填写同步 Token</span>
          ) : (
            <span className="font-mono tabular-nums text-ink-secondary">{quantStatus.loading ? '正在同步…' : quantStatus.summary || '等待首次同步'}</span>
          )}
          {quantStatus.asOf && quantStatus.pushedAt && (
            <div className="mt-1 font-mono tabular-nums text-ink-secondary">
              数据截至 {quantStatus.asOf}（IBKR 快照日）· 推送于 {new Date(quantStatus.pushedAt).toLocaleString()}
              {quantStatus.stale && <span className="ml-2 rounded bg-trim/10 px-1.5 py-0.5 font-medium text-trim">数据陈旧</span>}
            </div>
          )}
          {quantStatus.error && <div className="mt-1 text-trim">{quantStatus.error}</div>}
        </div>
        <button
          type="button"
          onClick={onRefreshQuant}
          disabled={quantStatus.loading || !quantGatewayAvailable || !quantSyncEnabled || !quantTokenConfigured}
          className="min-h-11 rounded-xl bg-buy/15 px-4 py-2 text-xs font-medium text-buy hover:bg-buy/25 disabled:cursor-not-allowed disabled:bg-neutral disabled:text-ink-muted"
        >
          {quantStatus.loading ? '同步中' : '从量化系统同步'}
        </button>
      </div>
    </div>
  );
}

function RiskOverview({ snapshot, displayCurrency, rates }: { snapshot?: QuantAnalysisSnapshot | null; displayCurrency: DisplayCurrency; rates: ExchangeRates }) {
  const ammo = snapshot?.ammo_overview;
  const maxLoss = snapshot?.max_loss;
  const options = snapshot?.option_exposure;
  const sleeves = snapshot?.sleeve_status;
  const allocation = snapshot?.allocation_plan;
  const dips = snapshot?.dip_status;
  const [displayBasis, setDisplayBasis] = useState<'both' | 'effective' | 'cash'>('both');
  if (!ammo && !maxLoss && !options && !sleeves && !allocation && !dips) return null;
  const power = ammo?.buying_power;
  const sleeveRows = sleeves ? ['tech', 'options', 'broad_dow', 'other'].flatMap((key) => sleeves[key] ? [[key, sleeves[key]] as const] : []) : [];
  const cashDenominator = ammo?.cash_exposure?.denominator_usd ?? snapshot?.invested_cash_total_usd ?? ammo?.cash_exposure?.invested_usd;
  const estimatedDelta = options?.items?.some((item) => item.delta_source !== 'broker') ?? false;
  const effectivePct = ammo?.exposure?.effective_pct ?? snapshot?.total_effective_pct;
  return (
    <section className="grid gap-4 md:col-span-4 lg:grid-cols-2" aria-label="账户风险与资金总览">
      <div className="rounded-2xl border border-neutral/50 bg-surface-raised p-4">
        <div className="text-sm font-semibold text-ink-primary">风险总览</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <RiskMetric label="等效敞口" value={moneyOrUnavailable(ammo?.exposure?.effective_usd, displayCurrency, rates, estimatedDelta)} sub={effectivePct !== undefined ? `${estimatedDelta ? '≈' : ''}${effectivePct.toFixed(2)}% 净值` : '暂无'} />
          <RiskMetric label="实付现金" value={moneyOrUnavailable(ammo?.cash_exposure?.invested_usd, displayCurrency, rates)} sub={cashDenominator !== undefined ? `现金分母：已投现金合计 ${formatDisplayMoney(cashDenominator, displayCurrency, rates)}${ammo?.cash_exposure?.available_usd !== undefined ? ` · 可动用 ${formatDisplayMoney(ammo.cash_exposure.available_usd, displayCurrency, rates)}` : ''}` : '暂无'} />
          <RiskMetric label="最大可损" value={moneyOrUnavailable(maxLoss?.total_usd, displayCurrency, rates)} sub={maxLoss?.pct_of_nav !== undefined ? `${maxLoss.pct_of_nav.toFixed(2)}% 净值` : '暂无'} tone="trim" />
        </div>
        {estimatedDelta && <p className="mt-2 text-xs text-ink-muted">Delta 为统一假设 0.5，不是网站真实 Delta 口径</p>}
        <div className="mt-3 rounded-xl border border-neutral/35 bg-surface-overlay/60 p-3">
          <div className="text-xs font-medium text-ink-primary">弹药总览</div>
          <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-xs tabular-nums text-ink-secondary">
            <span>正股 {formatDisplayMoney(power?.by_underlying_usd ?? 0, displayCurrency, rates)}</span>
            <span>2× {formatDisplayMoney(power?.by_2x_usd ?? 0, displayCurrency, rates)}</span>
            <span>3× {formatDisplayMoney(power?.by_3x_usd ?? 0, displayCurrency, rates)}</span>
          </div>
          {power?.headline && <p className="mt-2 text-xs leading-relaxed text-trim">{power.headline}</p>}
          {ammo?.top_consumers?.length ? <p className="mt-2 font-mono text-[11px] tabular-nums text-ink-muted">主要敞口：{ammo.top_consumers.map((item) => `${item.symbol} ${item.pct_of_nav.toFixed(2)}%`).join(' · ')}</p> : null}
        </div>
      </div>
      <div className="rounded-2xl border border-neutral/50 bg-surface-raised p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-ink-primary">目标配比 65/5/25/5</div>
          <div className="inline-flex rounded-lg border border-neutral/45 bg-surface-overlay p-0.5 text-[11px]" aria-label="配比口径显示">
            {([['both', '双显'], ['effective', '等效'], ['cash', '现金']] as const).map(([basis, label]) => (
              <button key={basis} type="button" onClick={() => setDisplayBasis(basis)} className={`rounded-md px-2 py-1 font-medium ${displayBasis === basis ? 'bg-surface-raised text-ink-primary shadow-sm' : 'text-ink-secondary hover:text-ink-primary'}`}>{label}</button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-ink-secondary">上粗条为等效敞口、下细条为实付现金；同一基准分别计量，不混算。</p>
        <div className="mt-3 space-y-3">
          {sleeveRows.map(([name, row]) => <SleeveBar key={name} name={name} row={row} displayBasis={displayBasis} />)}
        </div>
        <AllocationPlan allocation={allocation} displayCurrency={displayCurrency} rates={rates} />
      </div>
      {options && <details className="rounded-2xl border border-neutral/50 bg-surface-raised p-4 lg:col-span-2"><summary className="cursor-pointer text-sm font-semibold text-ink-primary">期权风险专区 · Delta 敞口 {moneyOrUnavailable(options.delta_exposure_usd, displayCurrency, rates, estimatedDelta)}</summary>{estimatedDelta && <p className="mt-2 text-xs text-ink-muted">Delta 为统一假设 0.5，不是网站真实 Delta 口径</p>}<div className="mt-3 grid gap-3 sm:grid-cols-3"><RiskMetric label="权利金" value={moneyOrUnavailable(options.premium_usd, displayCurrency, rates)} sub={options.premium_pct_of_nav !== undefined && options.premium_cap_pct !== undefined ? `${options.premium_pct_of_nav.toFixed(2)}% / 上限 ${options.premium_cap_pct.toFixed(2)}%` : '暂无'} tone={options.over_limit ? 'trim' : undefined} />{options.items?.map((item, index) => <RiskMetric key={`${item.symbol}-${index}`} label={`${item.symbol} · ${item.delta_source === 'broker' ? '券商 Delta' : '估算 Delta'}`} value={moneyOrUnavailable(item.delta_notional_usd, displayCurrency, rates, item.delta_source !== 'broker')} sub={item.days_to_expiry === null || item.days_to_expiry === undefined ? '到期日暂无' : `距到期 ${item.days_to_expiry} 天`} tone={item.status === 'critical' ? 'trim' : undefined} />)}</div></details>}
      {dips && Object.entries(dips).map(([symbol, status]) => <div key={symbol} className="rounded-2xl border border-neutral/40 bg-surface-overlay/35 p-4 text-sm leading-relaxed text-ink-primary lg:col-span-2"><span className="font-mono font-semibold tabular-nums">{symbol}</span> · {status.companion_text || '暂无分批进度'}<div className="mt-1 font-mono text-xs tabular-nums text-ink-secondary">计划剩余 {formatDisplayMoney(status.ammo?.remaining_usd ?? 0, displayCurrency, rates)} · 账户可动用 {formatDisplayMoney(status.ammo?.account_gate?.allowed_usd ?? 0, displayCurrency, rates)}</div></div>)}
    </section>
  );
}

function RiskMetric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'trim' }) {
  return <div className="rounded-xl border border-neutral/35 bg-surface-overlay/60 p-3"><div className="text-xs text-ink-secondary">{label}</div><div className={`mt-1 font-mono text-lg font-semibold tabular-nums ${tone === 'trim' ? 'text-trim' : 'text-ink-primary'}`}>{value}</div><div className="mt-1 font-mono text-[11px] tabular-nums text-ink-secondary">{sub}</div></div>;
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
  const note = displayBasis === 'both'
    ? row.note
    : visibleMetrics[0]?.[1]?.note;
  return { visibleMetrics, note };
}

export function SleeveBar({ name, row, displayBasis }: { name: string; row: QuantSleeveStatus; displayBasis: SleeveDisplayBasis }) {
  const labels: Record<string, string> = { tech: '科技', options: '期权', broad_dow: '宽基+道指', other: '其他' };
  const label = labels[name] ?? name;
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
  const status = displayZone === 'over_hard_cap'
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
    return facts.length > 0 ? <p className="mt-1 font-mono text-[10px] leading-relaxed tabular-nums text-ink-secondary">{metricName(basis)}：{facts.join(' · ')}</p> : null;
  };
  const isDualBasis = displayBasis === 'both';
  const selectedBasis = isDualBasis ? null : visibleMetrics[0]?.[0];
  const selectedMetric = isDualBasis ? undefined : visibleMetrics[0]?.[1];
  const headerGuide = isDualBasis
    ? `${target === undefined ? '基准暂无' : `基准 ${target.toFixed(2)}%`}${hardCap !== null ? ` · 硬顶 ${hardCap.toFixed(2)}%` : ''}`
    : selectedBasis && selectedMetric?.available_target_pct !== undefined
      ? `${metricName(selectedBasis)}目标 ${selectedMetric.available_target_pct.toFixed(2)}%`
      : `${selectedBasis ? metricName(selectedBasis) : '本口径'}目标暂无`;
  const sharedTargetMarker = isDualBasis && target !== undefined
    ? <span className="absolute inset-y-0 w-px bg-ink-primary/70" style={{ left: progressWidth(target) }} title={`基准 ${target.toFixed(2)}%`} />
    : null;
  const sharedHardCapMarker = isDualBasis && hardCap !== null
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
  const borrowFootnote = name === 'tech'
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
    <div className="flex min-w-0 flex-col gap-1 text-xs sm:flex-row sm:items-start sm:justify-between sm:gap-2"><div className="min-w-0"><span className="font-medium text-ink-primary">{label}</span><span className={`ml-2 inline-block rounded-full px-1.5 py-0.5 text-[10px] ${statusClass}`}>{status}</span></div><span className="max-w-full break-words font-mono tabular-nums text-ink-secondary">{headerGuide}</span></div>
    {note && <p className={`mt-2 break-words text-sm leading-relaxed ${noteClass}`}>{note}</p>}
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums">
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
    <div className="mt-1 flex flex-wrap gap-x-2 font-mono text-[10px] tabular-nums text-ink-muted">{isDualBasis && <span>{target === undefined ? '基准暂无' : `↑ 基准 ${target.toFixed(0)}%`}</span>}{isDualBasis && hardCap !== null && <span className="text-loss">↑ 硬顶 {hardCap.toFixed(0)}%</span>}{displayBasis !== 'cash' && targetHint('effective', effective)}{displayBasis !== 'effective' && targetHint('cash', cash)}</div>
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

function AllocationPlan({ allocation, displayCurrency, rates }: { allocation: QuantPortfolioRisk['allocation_plan'] | undefined; displayCurrency: DisplayCurrency; rates: ExchangeRates }) {
  if (!allocation?.by_sleeve?.length) return null;
  type AllocationItem = NonNullable<NonNullable<QuantPortfolioRisk['allocation_plan']>['by_sleeve']>[number];
  const sleeveLabels: Record<string, string> = { tech: '科技', options: '期权', broad_dow: '宽基+道指', other: '其他' };
  const labelFor = (sleeve: string) => sleeveLabels[sleeve] ?? sleeve;
  const isSentinel = (priority: number | undefined) => (priority ?? 0) >= 90;
  const isBlocked = (item: AllocationItem) => Boolean(item.blocked || isSentinel(item.priority));
  const blockReason = (item: AllocationItem) => item.block_reason || '后端闸门未放行';
  const underweightText = (item: AllocationItem) => {
    if (item.underweight_pp === undefined) return '';
    const gap = item.gap_usd === undefined ? '' : ` · 缺口 ${formatDisplayMoney(item.gap_usd, displayCurrency, rates)}`;
    return `（低配 ${Math.abs(item.underweight_pp).toFixed(2)}pp${gap}；总额度为 0，并非不应补）`;
  };
  const available = allocation.total_available_usd;
  if (available !== undefined && available <= 0) {
    return <details className="mt-4 border-t border-neutral/35 pt-3 text-xs text-ink-secondary"><summary className="cursor-pointer font-medium text-ink-primary">当前无可分配弹药（闸门放行 $0）</summary><div className="mt-2 space-y-1">{allocation.by_sleeve.map((item) => <p key={item.sleeve}>{isBlocked(item) ? `不投：${labelFor(item.sleeve)} —— ${blockReason(item)}` : `待补：${labelFor(item.sleeve)}${underweightText(item)}${item.candidates?.length ? ` · ${item.candidates.map((candidate) => candidate.symbol).join('/')}` : ''}`}</p>)}</div></details>;
  }
  return <div className="mt-4 border-t border-neutral/35 pt-3 text-xs text-ink-secondary"><div className="font-medium text-ink-primary">弹药定向</div>{allocation.by_sleeve.map((item) => <div key={item.sleeve} className="mt-1 flex justify-between gap-2"><span>{isBlocked(item) ? `不投：${labelFor(item.sleeve)} —— ${blockReason(item)}` : `${item.priority !== undefined ? `优先 ${item.priority} · ` : ''}${labelFor(item.sleeve)}`}</span>{!isBlocked(item) && <span className="font-mono tabular-nums">{moneyOrUnavailable(item.suggested_usd, displayCurrency, rates)}{item.candidates?.length ? ` · ${item.candidates.map((candidate) => candidate.symbol).join('/')}` : ''}</span>}</div>)}</div>;
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
    <div className={`${isHero ? `rounded-2xl border border-neutral/60 border-l-4 p-6 md:col-span-2 ${accentClass}` : 'rounded-2xl border border-neutral/40 p-4'} bg-surface-raised`}>
      <div className={`${isHero ? 'text-sm font-medium' : 'text-xs'} text-ink-secondary`}>{label}</div>
      <div className={`mt-2 font-mono font-semibold leading-none tracking-tight tabular-nums ${isHero ? 'text-4xl' : 'text-xl'} ${valueClass ?? ''}`}>{value}</div>
      {sub && <div className={`mt-2 font-mono tabular-nums ${isHero ? 'text-sm' : 'text-xs'} ${subClass ?? 'text-ink-secondary'}`}>{sub}</div>}
      {children}
    </div>
  );
}
