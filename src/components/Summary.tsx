import type { PortfolioMetrics } from '../types';
import { formatMoney, formatPct, formatSignedPct } from '../format';

interface SummaryProps {
  metrics: PortfolioMetrics;
}

export function Summary({ metrics }: SummaryProps) {
  const pnlClass =
    metrics.totalPnl > 0 ? 'text-emerald-600' : metrics.totalPnl < 0 ? 'text-rose-600' : 'text-slate-500';
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card label="总资产" value={formatMoney(metrics.totalValue)} />
      <Card label="股票市值" value={formatMoney(metrics.equityValue)} sub={`${formatPct(1 - metrics.cashWeight)}`} />
      <Card label="现金" value={formatMoney(metrics.cashValue)} sub={formatPct(metrics.cashWeight)} />
      <Card
        label="总盈亏"
        value={formatMoney(metrics.totalPnl)}
        sub={formatSignedPct(metrics.totalPnlPct)}
        valueClass={pnlClass}
        subClass={pnlClass}
      />
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
