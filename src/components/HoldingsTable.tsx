import { useState } from 'react';
import type { Holding, HoldingMetric } from '../types';
import { formatMoney, formatPct, formatSignedPct } from '../format';

interface HoldingsTableProps {
  metrics: HoldingMetric[];
  onUpdate: (id: string, patch: Partial<Holding>) => void;
  onDelete: (id: string) => void;
  onAdd: (h: Omit<Holding, 'id'>) => void;
}

const emptyDraft: Omit<Holding, 'id'> = {
  symbol: '',
  name: '',
  shares: 0,
  buyPrice: 0,
  currentPrice: 0,
  sector: '',
  currency: 'USD',
  note: '',
};

const SECTOR_PRESETS = [
  '科技', '半导体', '消费', '医疗', '金融', '能源',
  '工业', '通信', '公用事业', '地产', '材料', 'ETF / 指数', '其他',
];

export function HoldingsTable({ metrics, onUpdate, onDelete, onAdd }: HoldingsTableProps) {
  const [draft, setDraft] = useState<Omit<Holding, 'id'>>(emptyDraft);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.symbol.trim()) return;
    onAdd({ ...draft, symbol: draft.symbol.trim().toUpperCase() });
    setDraft(emptyDraft);
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={submit}
        className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800 sm:grid-cols-7"
      >
        <input
          required
          placeholder="代码 AAPL"
          value={draft.symbol}
          onChange={(e) => setDraft({ ...draft, symbol: e.target.value })}
          className={inputCls}
        />
        <input
          placeholder="名称"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className={inputCls}
        />
        <input
          type="number"
          step="any"
          min={0}
          placeholder="股数"
          value={draft.shares || ''}
          onChange={(e) => setDraft({ ...draft, shares: Number(e.target.value) })}
          className={inputCls}
        />
        <input
          type="number"
          step="any"
          min={0}
          placeholder="买入价"
          value={draft.buyPrice || ''}
          onChange={(e) => setDraft({ ...draft, buyPrice: Number(e.target.value) })}
          className={inputCls}
        />
        <input
          type="number"
          step="any"
          min={0}
          placeholder="当前价"
          value={draft.currentPrice || ''}
          onChange={(e) => setDraft({ ...draft, currentPrice: Number(e.target.value) })}
          className={inputCls}
        />
        <select
          value={draft.sector}
          onChange={(e) => setDraft({ ...draft, sector: e.target.value })}
          className={inputCls}
        >
          <option value="">行业</option>
          {SECTOR_PRESETS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button
          type="submit"
          className="col-span-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 sm:col-span-1"
        >
          添加
        </button>
      </form>

      {metrics.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          还没有持仓。在上方添加你的第一只股票。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <tr>
                <Th>代码</Th>
                <Th>名称</Th>
                <Th>行业</Th>
                <Th className="text-right">股数</Th>
                <Th className="text-right">买入价</Th>
                <Th className="text-right">当前价</Th>
                <Th className="text-right">市值</Th>
                <Th className="text-right">占比</Th>
                <Th className="text-right">盈亏</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {metrics.map((m) => (
                <Row key={m.holding.id} metric={m} onUpdate={onUpdate} onDelete={onDelete} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const inputCls =
  'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900';

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left ${className ?? ''}`}>{children}</th>;
}

interface RowProps {
  metric: HoldingMetric;
  onUpdate: (id: string, patch: Partial<Holding>) => void;
  onDelete: (id: string) => void;
}

function Row({ metric, onUpdate, onDelete }: RowProps) {
  const { holding } = metric;
  const pnlClass = metric.pnl > 0 ? 'text-emerald-600' : metric.pnl < 0 ? 'text-rose-600' : 'text-slate-500';
  return (
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
      <td className="px-3 py-2 font-medium">{holding.symbol}</td>
      <td className="px-3 py-2">
        <input
          value={holding.name}
          onChange={(e) => onUpdate(holding.id, { name: e.target.value })}
          className="w-24 bg-transparent focus:outline-none"
        />
      </td>
      <td className="px-3 py-2">
        <input
          value={holding.sector}
          onChange={(e) => onUpdate(holding.id, { sector: e.target.value })}
          className="w-20 bg-transparent focus:outline-none"
        />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <input
          type="number"
          step="any"
          value={holding.shares}
          onChange={(e) => onUpdate(holding.id, { shares: Number(e.target.value) })}
          className="w-20 bg-transparent text-right tabular-nums focus:outline-none"
        />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <input
          type="number"
          step="any"
          value={holding.buyPrice}
          onChange={(e) => onUpdate(holding.id, { buyPrice: Number(e.target.value) })}
          className="w-20 bg-transparent text-right tabular-nums focus:outline-none"
        />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <input
          type="number"
          step="any"
          value={holding.currentPrice}
          onChange={(e) => onUpdate(holding.id, { currentPrice: Number(e.target.value) })}
          className="w-20 bg-transparent text-right tabular-nums focus:outline-none"
        />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(metric.marketValue)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatPct(metric.weight)}</td>
      <td className={`px-3 py-2 text-right tabular-nums ${pnlClass}`}>
        <div>{formatMoney(metric.pnl)}</div>
        <div className="text-xs">{formatSignedPct(metric.pnlPct)}</div>
      </td>
      <td className="px-3 py-2 text-right">
        <button
          onClick={() => onDelete(holding.id)}
          className="text-xs text-rose-600 hover:underline"
          aria-label={`删除 ${holding.symbol}`}
        >
          删除
        </button>
      </td>
    </tr>
  );
}
