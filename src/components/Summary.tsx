import type { DisplayCurrency, ExchangeRates, PortfolioMetrics, QuantAnalysisSnapshot } from '../types';
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
            <div className="text-sm font-semibold text-ink-primary">一键刷新全部</div>
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
      <Card label={`持仓市值（${displayCurrency}）`} value={formatDisplayMoney(metrics.equityValue, displayCurrency, rates)} sub={`${formatPct(1 - metrics.cashWeight)}`} />
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
          <div className="mt-1 text-[11px] text-ink-secondary">网站口径：期权按 Delta 折算</div>
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
            {quoteStatus.loading ? '正在刷新…' : quoteStatus.summary || (canRefreshQuotes ? '美股盘中每 35 分钟自动刷新' : '未配置行情源')}
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
  if (!ammo && !maxLoss && !options && !sleeves && !allocation && !dips) return null;
  const power = ammo?.buying_power;
  const sleeveRows = sleeves ? ['tech', 'options', 'broad_dow'].flatMap((key) => sleeves[key] ? [[key, sleeves[key]] as const] : []) : [];
  return (
    <section className="grid gap-4 md:col-span-4 lg:grid-cols-2" aria-label="账户风险与资金总览">
      <div className="rounded-2xl border border-neutral/50 bg-surface-raised p-4">
        <div className="text-sm font-semibold text-ink-primary">风险总览</div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <RiskMetric label="等效敞口" value={formatDisplayMoney(ammo?.exposure?.effective_usd ?? 0, displayCurrency, rates)} sub={ammo?.exposure?.effective_pct !== undefined ? `${ammo.exposure.effective_pct.toFixed(2)}% 净值` : '暂无'} />
          <RiskMetric label="最大可损" value={formatDisplayMoney(maxLoss?.total_usd ?? 0, displayCurrency, rates)} sub={maxLoss?.pct_of_nav !== undefined ? `${maxLoss.pct_of_nav.toFixed(2)}% 净值` : '暂无'} tone="trim" />
        </div>
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
        <div className="text-sm font-semibold text-ink-primary">目标配比 65/5/30</div>
        <div className="mt-3 space-y-3">
          {sleeveRows.map(([name, row]) => <SleeveBar key={name} name={name} pct={row.pct} target={row.target_pct} />)}
        </div>
        {allocation?.by_sleeve?.length ? <div className="mt-4 border-t border-neutral/35 pt-3 text-xs text-ink-secondary"><div className="font-medium text-ink-primary">弹药定向</div>{allocation.by_sleeve.slice(0, 3).map((item) => <div key={item.sleeve} className="mt-1 flex justify-between gap-2"><span>{item.priority ? `优先 ${item.priority} · ` : ''}{item.sleeve}</span><span className="font-mono tabular-nums">{formatDisplayMoney(item.suggested_usd ?? 0, displayCurrency, rates)}{item.candidates?.length ? ` · ${item.candidates.map((candidate) => candidate.symbol).join('/')}` : ''}</span></div>)}</div> : null}
      </div>
      {options && <details className="rounded-2xl border border-neutral/50 bg-surface-raised p-4 lg:col-span-2"><summary className="cursor-pointer text-sm font-semibold text-ink-primary">期权风险专区 · Delta 敞口 {formatDisplayMoney(options.delta_exposure_usd ?? 0, displayCurrency, rates)}</summary><div className="mt-3 grid gap-3 sm:grid-cols-3"><RiskMetric label="权利金" value={formatDisplayMoney(options.premium_usd ?? 0, displayCurrency, rates)} sub={`${(options.premium_pct_of_nav ?? 0).toFixed(2)}% / 上限 ${(options.premium_cap_pct ?? 0).toFixed(2)}%`} tone={options.over_limit ? 'trim' : undefined} />{options.items?.map((item, index) => <RiskMetric key={`${item.symbol}-${index}`} label={`${item.symbol} · ${item.delta_source === 'broker' ? '券商 Delta' : '估算 Delta'}`} value={formatDisplayMoney(item.delta_notional_usd ?? 0, displayCurrency, rates)} sub={item.days_to_expiry === null || item.days_to_expiry === undefined ? '到期日暂无' : `距到期 ${item.days_to_expiry} 天`} tone={item.status === 'critical' ? 'trim' : undefined} />)}</div></details>}
      {dips && Object.entries(dips).map(([symbol, status]) => <div key={symbol} className="rounded-2xl border border-buy/30 bg-buy/5 p-4 text-sm leading-relaxed text-ink-primary lg:col-span-2"><span className="font-mono font-semibold tabular-nums">{symbol}</span> · {status.companion_text || '暂无分批进度'}<div className="mt-1 font-mono text-xs tabular-nums text-ink-secondary">计划剩余 {formatDisplayMoney(status.ammo?.remaining_usd ?? 0, displayCurrency, rates)} · 账户可动用 {formatDisplayMoney(status.ammo?.account_gate?.allowed_usd ?? 0, displayCurrency, rates)}</div></div>)}
    </section>
  );
}

function RiskMetric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'trim' }) {
  return <div className="rounded-xl border border-neutral/35 bg-surface-overlay/60 p-3"><div className="text-xs text-ink-secondary">{label}</div><div className={`mt-1 font-mono text-lg font-semibold tabular-nums ${tone === 'trim' ? 'text-trim' : 'text-ink-primary'}`}>{value}</div><div className="mt-1 font-mono text-[11px] tabular-nums text-ink-secondary">{sub}</div></div>;
}

function SleeveBar({ name, pct, target }: { name: string; pct?: number; target?: number }) {
  const current = Math.max(0, pct ?? 0);
  const targetPct = Math.max(0, target ?? 0);
  const width = Math.min(100, current);
  return <div><div className="flex justify-between gap-2 text-xs"><span className="text-ink-primary">{name}</span><span className="font-mono tabular-nums text-ink-secondary">{current.toFixed(2)}% / {targetPct.toFixed(2)}%</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-overlay"><div className="h-full rounded-full bg-buy transition-[width] duration-200 ease-out motion-reduce:transition-none" style={{ width: `${width}%` }} /></div></div>;
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
