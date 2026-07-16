import type { DisplayCurrency, ExchangeRates, PortfolioMetrics } from '../types';
import { formatPct, formatSignedPct } from '../format';
import { formatDisplayMoney } from '../displayCurrency';
import { convertFromUsd } from '../displayCurrency';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import type { ValuePoint } from '../valueHistory';

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
}

export function Summary({ metrics, rates, displayCurrency, onDisplayCurrencyChange, valueHistory, rateError, quoteStatus, dayChangeStatusText, canRefreshQuotes, onRefreshQuotes, exposureTargetPct, quantStatus, quantSyncEnabled, quantGatewayAvailable, quantTokenConfigured, onRefreshQuant }: SummaryProps) {
  const dayClass =
    metrics.dayChange > 0 ? 'text-emerald-600' : metrics.dayChange < 0 ? 'text-rose-600' : 'text-slate-500';
  const trendPoints = valueHistory.slice(-30).map((point) => ({
    ...point,
    value: convertFromUsd(point.totalValueUsd, displayCurrency, rates),
  }));
  const trendStart = trendPoints[Math.max(0, trendPoints.length - 8)];
  const trendEnd = trendPoints.at(-1);
  const trendPct = trendStart && trendEnd && trendStart.totalValueUsd > 0
    ? trendEnd.totalValueUsd / trendStart.totalValueUsd - 1
    : 0;
  const trendClass = trendPct > 0 ? 'text-emerald-600' : trendPct < 0 ? 'text-rose-600' : 'text-slate-500';
  const trendColor = trendPct < 0 ? '#e11d48' : '#059669';
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card label={`总资产（${displayCurrency}）`} value={formatDisplayMoney(metrics.totalValue, displayCurrency, rates)}>
        {trendPoints.length >= 2 && (
          <div className="mt-1">
            <div className="h-10 w-full" aria-label="近 30 天总资产趋势">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendPoints}>
                  <Line type="monotone" dataKey="value" stroke={trendColor} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className={`text-[11px] ${trendClass}`}>
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
      >
        {dayChangeStatusText && (
          <div className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            {dayChangeStatusText}
          </div>
        )}
      </Card>
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
          <div className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            正股 {formatDisplayMoney(metrics.plainEquityExposure, displayCurrency, rates)} · 杠杆折算 {formatDisplayMoney(metrics.leveragedEtfExposure, displayCurrency, rates)} · 期权Δ {formatDisplayMoney(metrics.optionDeltaExposure, displayCurrency, rates)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">网站口径：期权按 Delta 折算</div>
          {metrics.uncomputableOptions > 0 && (
            <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-300">
              ⚠ {metrics.uncomputableOptions} 个期权缺 Delta/标的价未计入（用「补充期权详情」导入）
            </div>
          )}
        </Card>
      )}
      <div className="col-span-2 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:col-span-4">
        <label className="font-medium text-slate-700 dark:text-slate-200">
          显示货币：
          <select
            aria-label="显示货币"
            value={displayCurrency}
            onChange={(event) => onDisplayCurrencyChange(event.target.value as DisplayCurrency)}
            className="ml-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-900"
          >
            {(['USD', 'CNY', 'HKD', 'JPY', 'EUR', 'GBP'] as DisplayCurrency[]).map((currency) => (
              <option key={currency} value={currency}>{currency}</option>
            ))}
          </select>
        </label>
        <span className="ml-3 text-slate-500 dark:text-slate-400">1 USD ≈ {rates.CNY.toFixed(4)} CNY</span>
        <span className="ml-2 text-slate-400">{rates.source === 'live' ? `实时数据 ${rates.updatedAt ?? ''}` : rates.source === 'cache' ? `缓存数据 ${rates.updatedAt ?? ''}` : '近似兜底值'}</span>
        {rateError && <span className="ml-2 text-amber-600 dark:text-amber-300">{rateError}</span>}
      </div>
      <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:col-span-4">
        <div>
          <span className="font-medium text-slate-700 dark:text-slate-200">行情同步：</span>
          <span className="text-slate-500 dark:text-slate-400">
            {quoteStatus.loading ? '正在刷新…' : quoteStatus.summary || (canRefreshQuotes ? '美股盘中每 35 分钟自动刷新' : '未配置行情源')}
          </span>
          {quoteStatus.lastSyncedAt && <span className="ml-2 text-slate-400">{new Date(quoteStatus.lastSyncedAt).toLocaleString()}</span>}
          {quoteStatus.error && <span className="ml-2 text-amber-600 dark:text-amber-300">{quoteStatus.error}</span>}
        </div>
        <button
          type="button"
          onClick={onRefreshQuotes}
          disabled={quoteStatus.loading || !canRefreshQuotes}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {quoteStatus.loading ? '刷新中' : '手动刷新'}
        </button>
      </div>
      <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:col-span-4">
        <div className="min-w-0">
          <span className="font-medium text-slate-700 dark:text-slate-200">量化系统同步：</span>
          {!quantGatewayAvailable ? (
            <span className="text-amber-600 dark:text-amber-300">量化同步仅在 VPS 入口可用</span>
          ) : !quantSyncEnabled ? (
            <span className="text-slate-500 dark:text-slate-400">未启用</span>
          ) : !quantTokenConfigured ? (
            <span className="text-amber-600 dark:text-amber-300">未填写同步 Token</span>
          ) : (
            <span className="text-slate-500 dark:text-slate-400">{quantStatus.loading ? '正在同步…' : quantStatus.summary || '等待首次同步'}</span>
          )}
          {quantStatus.asOf && quantStatus.pushedAt && (
            <div className="mt-1 text-slate-500 dark:text-slate-400">
              数据截至 {quantStatus.asOf}（IBKR 快照日）· 推送于 {new Date(quantStatus.pushedAt).toLocaleString()}
              {quantStatus.stale && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">数据陈旧</span>}
            </div>
          )}
          {quantStatus.error && <div className="mt-1 text-amber-600 dark:text-amber-300">{quantStatus.error}</div>}
        </div>
        <button
          type="button"
          onClick={onRefreshQuant}
          disabled={quantStatus.loading || !quantGatewayAvailable || !quantSyncEnabled || !quantTokenConfigured}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-400"
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
  children?: React.ReactNode;
}

function Card({ label, value, sub, valueClass, subClass, children }: CardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${valueClass ?? ''}`}>{value}</div>
      {sub && <div className={`text-xs tabular-nums ${subClass ?? 'text-slate-500 dark:text-slate-400'}`}>{sub}</div>}
      {children}
    </div>
  );
}
