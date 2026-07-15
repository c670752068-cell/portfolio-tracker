import { toUsd } from '../exchangeRates';
import type { CashPosition, ExchangeRates } from '../types';
import { formatMoney } from '../format';

interface CashEditorProps {
  cash: CashPosition[];
  rates: ExchangeRates;
  onChange: (next: CashPosition[]) => void;
}

const CURRENCIES: CashPosition['currency'][] = ['USD', 'CNY', 'HKD', 'OTHER'];

export function CashEditor({ cash, rates, onChange }: CashEditorProps) {
  function update(i: number, patch: Partial<CashPosition>) {
    const next = cash.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    onChange(next);
  }
  function add() {
    onChange([...cash, { amount: 0, currency: 'USD' }]);
  }
  function remove(i: number) {
    onChange(cash.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">现金持仓</h3>
        <button onClick={add} className="text-xs text-indigo-600 hover:underline">
          + 添加现金条目
        </button>
      </div>
      {cash.length === 0 && (
        <p className="text-xs text-slate-500">添加现金条目后会计入资产并参与占比计算。</p>
      )}
      {cash.map((c, i) => (
        <div key={i} className="grid grid-cols-6 gap-2 text-sm">
          <input
            type="number"
            step="any"
            value={c.amount || ''}
            placeholder="金额"
            onChange={(e) => update(i, { amount: Number(e.target.value) })}
            className="col-span-3 rounded-md border border-slate-300 bg-white px-2 py-1.5 focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900"
          />
          <select
            value={c.currency}
            onChange={(e) => update(i, { currency: e.target.value as CashPosition['currency'] })}
            className="col-span-2 rounded-md border border-slate-300 bg-white px-2 py-1.5 focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900"
          >
            {CURRENCIES.map((cc) => (
              <option key={cc} value={cc}>{cc}</option>
            ))}
          </select>
          <button onClick={() => remove(i)} className="text-xs text-rose-600">删</button>
          <div className="col-span-6 text-xs text-slate-500">折算显示：{formatMoney(c.amount, c.currency)} {toUsd(c.amount, c.currency, rates) != null && c.currency !== 'USD' ? `≈ ${formatMoney(toUsd(c.amount, c.currency, rates) ?? 0)} USD` : ''}</div>
          {c.note && <div className="col-span-6 text-xs text-amber-600 dark:text-amber-300">{c.note}</div>}
        </div>
      ))}
      <p className="text-xs text-slate-400">
        CNY、HKD 会按页面顶部显示的 USD 汇率折算并计入总资产；OTHER 币种需先改为支持币种，避免错误相加。
      </p>
    </div>
  );
}
