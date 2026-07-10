import type { ExchangeRates, PortfolioMetrics } from '../types';
import { formatMoney, formatPct, formatSignedPct } from '../format';

interface SummaryProps {
  metrics: PortfolioMetrics;
  rates: ExchangeRates;
  rateError: string;
}

export function Summary({ metrics, rates, rateError }: SummaryProps) {
  const pnlClass =
    metrics.totalPnl > 0 ? 'text-emerald-600' : metrics.totalPnl < 0 ? 'text-rose-600' : 'text-slate-500';
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card label="总资产（USD）" value={formatMoney(metrics.totalValue)} />
      <Card label="持仓市值（USD）" value={formatMoney(metrics.equityValue)} sub={`${formatPct(1 - metrics.cashWeight)}`} />
      <Card label="现金（USD）" value={formatMoney(metrics.cashValue)} sub={formatPct(metrics.cashWeight)} />
      <Card
        label={metrics.unknownCostItems > 0 ? '总盈亏（已知成本）' : '总盈亏'}
        value={formatMoney(metrics.totalPnl)}
        sub={metrics.unknownCostItems > 0 ? `${metrics.unknownCostItems} 个条目成本待补` : formatSignedPct(metrics.totalPnlPct)}
        valueClass={pnlClass}
        subClass={pnlClass}
      />
      {metrics.optionValue > 0 && (
        <>
          <Card label="期权权利金（USD）" value={formatMoney(metrics.optionValue)} sub={`${formatPct(metrics.optionWeight)} 的总资产`} />
          <Card label="期权 Delta 暴露" value={formatMoney(metrics.deltaAdjustedExposure)} sub="仅已识别 Delta/标的现价的合约" />
        </>
      )}
      <div className="col-span-2 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:col-span-4">
        <span className="font-medium text-slate-700 dark:text-slate-200">汇率换算：</span>
        <span className="text-slate-500 dark:text-slate-400">1 USD ≈ {rates.CNY.toFixed(4)} CNY · {rates.HKD.toFixed(4)} HKD</span>
        <span className="ml-2 text-slate-400">{rates.source === 'live' ? `实时数据 ${rates.updatedAt ?? ''}` : rates.source === 'cache' ? `缓存数据 ${rates.updatedAt ?? ''}` : '近似兜底值'}</span>
        {rateError && <span className="ml-2 text-amber-600 dark:text-amber-300">{rateError}</span>}
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
}

function Card({ label, value, sub, valueClass, subClass }: CardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${valueClass ?? ''}`}>{value}</div>
      {sub && <div className={`text-xs tabular-nums ${subClass ?? 'text-slate-500 dark:text-slate-400'}`}>{sub}</div>}
    </div>
  );
}
