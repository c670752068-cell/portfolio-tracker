import type { CashPosition } from '../types';
import { formatMoney } from '../format';

interface CashEditorProps {
  cash: CashPosition[];
  onChange: (next: CashPosition[]) => void;
}

const CURRENCIES: CashPosition['currency'][] = ['USD', 'CNY', 'HKD', 'OTHER'];

export function CashEditor({ cash, onChange }: CashEditorProps) {
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
            min={0}
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
          <div className="col-span-6 text-xs text-slate-500">折算显示：{formatMoney(c.amount, c.currency)}</div>
        </div>
      ))}
      <p className="text-xs text-slate-400">
        注：当前版本不做汇率换算，多币种现金按原币种数值直接相加。如需汇率换算，可在后续版本接入。
      </p>
    </div>
  );
}
