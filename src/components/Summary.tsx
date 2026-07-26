import type { DisplayCurrency, ExchangeRates, PortfolioMetrics } from '../types';
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
}

export function Summary({ metrics, rates, displayCurrency, onDisplayCurrencyChange, valueHistory, rateError, quoteStatus, dayChangeStatusText, canRefreshQuotes, onRefreshQuotes, exposureTargetPct, quantStatus, quantSyncEnabled, quantGatewayAvailable, quantTokenConfigured, onRefreshQuant, oneTapRefreshState, canOneTapRefresh, oneTapCooldownSeconds, onOneTapRefresh }: SummaryProps) {
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
