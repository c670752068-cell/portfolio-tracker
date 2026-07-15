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
  canRefreshQuotes: boolean;
  onRefreshQuotes: () => void;
  exposureTargetPct: number;
}

export function Summary({ metrics, rates, displayCurrency, onDisplayCurrencyChange, valueHistory, rateError, quoteStatus, canRefreshQuotes, onRefreshQuotes, exposureTargetPct }: SummaryProps) {
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
      />
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
            {quoteStatus.loading ? '正在刷新…' : quoteStatus.summary || (canRefreshQuotes ? '北京时间每天 7 点后自动刷新一次' : '未配置行情源')}
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
