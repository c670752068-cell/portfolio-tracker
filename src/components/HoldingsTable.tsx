import { useState } from 'react';
import type { AssetType, Currency, Holding, HoldingMetric } from '../types';
import { formatMoney, formatPct, formatSignedPct } from '../format';
import { CASH_EQUIVALENT_SYMBOLS, isCashEquivalent } from '../assetClass';

interface HoldingsTableProps {
  metrics: HoldingMetric[];
  onUpdate: (id: string, patch: Partial<Holding>) => void;
  onDelete: (id: string) => void;
  onAdd: (holding: Omit<Holding, 'id'>) => void;
}

const emptyDraft: Omit<Holding, 'id'> = {
  symbol: '',
  name: '',
  shares: 0,
  buyPrice: 0,
  currentPrice: 0,
  sector: '',
  currency: 'USD',
  assetType: 'stock',
  note: '',
  source: 'manual',
};

const SECTOR_PRESETS = ['科技', '半导体', '消费', '医疗', '金融', '能源', '工业', '通信', '公用事业', '地产', '材料', 'ETF / 指数', '其他'];
const CURRENCIES: Currency[] = ['USD', 'CNY', 'HKD', 'OTHER'];
const ASSET_TYPES: Array<{ value: AssetType; label: string }> = [
  { value: 'stock', label: '股票' },
  { value: 'etf', label: 'ETF' },
  { value: 'leveraged_etf', label: '杠杆 ETF' },
  { value: 'option', label: '期权' },
  { value: 'fund', label: '基金' },
  { value: 'other', label: '其他' },
];

export function HoldingsTable({ metrics, onUpdate, onDelete, onAdd }: HoldingsTableProps) {
  const [draft, setDraft] = useState<Omit<Holding, 'id'>>(emptyDraft);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.symbol.trim()) return;
    onAdd({ ...draft, symbol: draft.symbol.trim().toUpperCase(), source: 'manual' });
    setDraft(emptyDraft);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="mb-2 text-sm font-semibold">手动补充持仓</h2>
        <p className="mb-2 text-xs text-slate-500">更适合补充现金、少量持仓，或修正 AI 截图识别结果。期权建议同时上传合约详情页，才能计算 Delta 等效正股。</p>
        <form onSubmit={submit} className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800 sm:grid-cols-4 lg:grid-cols-8">
          <input required placeholder="代码 AAPL" value={draft.symbol} onChange={(event) => setDraft({ ...draft, symbol: event.target.value })} className={inputCls} />
          <input placeholder="名称" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={inputCls} />
          <select value={draft.assetType} onChange={(event) => setDraft({ ...draft, assetType: event.target.value as AssetType })} className={inputCls}>
            {ASSET_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
          <select value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value as Currency })} className={inputCls}>
            {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </select>
          <input type="number" step="any" min={0} placeholder={draft.assetType === 'option' ? '合约张数' : '股数'} value={draft.shares || ''} onChange={(event) => setDraft({ ...draft, shares: Number(event.target.value) })} className={inputCls} />
          <input type="number" step="any" min={0} placeholder="买入价" value={draft.buyPrice || ''} onChange={(event) => setDraft({ ...draft, buyPrice: Number(event.target.value) })} className={inputCls} />
          <input type="number" step="any" min={0} placeholder="当前价" value={draft.currentPrice || ''} onChange={(event) => setDraft({ ...draft, currentPrice: Number(event.target.value) })} className={inputCls} />
          <select value={draft.sector} onChange={(event) => setDraft({ ...draft, sector: event.target.value })} className={inputCls}>
            <option value="">行业</option>
            {SECTOR_PRESETS.map((sector) => <option key={sector} value={sector}>{sector}</option>)}
          </select>
          <label className="col-span-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 sm:col-span-4 lg:col-span-8">
            <input
              type="checkbox"
              checked={draft.cashEquivalent === true || CASH_EQUIVALENT_SYMBOLS.has(draft.symbol.trim().toUpperCase())}
              onChange={(event) => setDraft({ ...draft, cashEquivalent: event.target.checked })}
            />
            现金等价物
          </label>
          <button type="submit" className="col-span-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 sm:col-span-4 lg:col-span-8">添加持仓</button>
        </form>
      </div>

      {metrics.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          尚无持仓。上传券商截图，或在上方手动添加第一笔持仓。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
          <table className="min-w-[1050px] divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <tr>
                <Th>代码 / 类型</Th><Th>名称 / 行业</Th><Th className="text-right">数量</Th><Th className="text-right">买入价</Th><Th className="text-right">当前价 / 市值</Th><Th className="text-right">今日</Th><Th className="text-right">USD 占比</Th><Th className="text-right">盈亏</Th><Th>期权等效正股</Th><Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {metrics.map((metric) => <Row key={metric.holding.id} metric={metric} onUpdate={onUpdate} onDelete={onDelete} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const inputCls = 'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900';

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
  const dayClass = metric.dayChange > 0 ? 'text-emerald-600' : metric.dayChange < 0 ? 'text-rose-600' : 'text-slate-500';
  const isOption = holding.assetType === 'option';
  const needsPnlCheck = holding.missingFields?.includes('成本待核对') ?? false;
  const label = ASSET_TYPES.find((type) => type.value === (holding.assetType ?? 'stock'))?.label ?? '股票';
  const optionDescription = holding.option
    ? `${holding.option.underlying} ${holding.option.optionType.toUpperCase()} ${holding.option.strike ?? '—'} · ${holding.option.expiration ?? '到期日待补'}`
    : '';
  return (
    <tr className="align-top hover:bg-slate-50 dark:hover:bg-slate-700/40">
      <td className="px-3 py-2"><div className="font-medium">{holding.symbol}</div><div className="text-xs text-slate-500">{label} · {holding.currency}</div>{optionDescription && <div className="mt-1 max-w-44 text-xs text-slate-500">{optionDescription}</div>}</td>
      <td className="px-3 py-2"><input value={holding.name} onChange={(event) => onUpdate(holding.id, { name: event.target.value })} className="w-28 bg-transparent focus:outline-none" placeholder="名称" /><input value={holding.sector} onChange={(event) => onUpdate(holding.id, { sector: event.target.value })} className="mt-1 w-24 bg-transparent text-xs text-slate-500 focus:outline-none" placeholder="行业" /><label className="mt-1 flex items-center gap-1 text-xs text-slate-500"><input type="checkbox" checked={isCashEquivalent(holding)} onChange={(event) => onUpdate(holding.id, { cashEquivalent: event.target.checked })} />现金等价物</label>{holding.missingFields && holding.missingFields.length > 0 && <div className="mt-1 max-w-36 text-xs text-amber-600">待补：{holding.missingFields.join('、')}</div>}{holding.quote?.note && <div className="mt-1 max-w-44 text-xs text-indigo-600 dark:text-indigo-300">{holding.quote.note}</div>}</td>
      <td className="px-3 py-2 text-right tabular-nums"><input type="number" step="any" value={holding.shares} onChange={(event) => onUpdate(holding.id, { shares: Number(event.target.value), marketValueOverride: undefined, costOverride: undefined })} className="w-20 bg-transparent text-right tabular-nums focus:outline-none" /><div className="text-xs text-slate-500">{isOption ? '合约张数' : '股'}</div></td>
      <td className="px-3 py-2 text-right tabular-nums"><input type="number" step="any" value={holding.buyPrice} onChange={(event) => onUpdate(holding.id, { buyPrice: Number(event.target.value), costOverride: undefined })} className="w-20 bg-transparent text-right tabular-nums focus:outline-none" /><div className="text-xs text-slate-500">{holding.currency}</div></td>
      <td className="px-3 py-2 text-right tabular-nums"><input type="number" step="any" value={holding.currentPrice} onChange={(event) => onUpdate(holding.id, { currentPrice: Number(event.target.value), marketValueOverride: undefined })} className="w-20 bg-transparent text-right tabular-nums focus:outline-none" /><div className="mt-1 text-xs font-medium">{formatMoney(metric.marketValueNative, holding.currency)}</div>{holding.currency !== 'USD' && <div className="text-xs text-slate-500">≈ {formatMoney(metric.marketValue)} USD</div>}</td>
      <td className={`px-3 py-2 text-right tabular-nums ${dayClass}`}>{holding.quote?.change != null ? <><div>{formatMoney(metric.dayChange)}</div><div className="text-xs">{metric.dayChangePct != null ? formatSignedPct(metric.dayChangePct) : '涨跌率待补'}</div><div className="text-xs text-slate-400">{quoteSourceLabel(holding.quote.source)}</div></> : <div className="text-xs text-slate-400">未同步</div>}</td>
      <td className="px-3 py-2 text-right tabular-nums"><div>{formatMoney(metric.marketValue)}</div><div className="text-xs text-slate-500">{formatPct(metric.weight)}</div></td>
      <td className={`px-3 py-2 text-right tabular-nums ${pnlClass}`}>
        {needsPnlCheck && <span className="mr-1 text-amber-500" title="盈亏与券商截图不符，请核对买入价/股数">⚠</span>}
        {metric.costKnown ? <><div>{formatMoney(metric.pnl)}</div><div className="text-xs">{formatSignedPct(metric.pnlPct)}</div></> : <div className="text-xs text-amber-600">成本待补</div>}
      </td>
      <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">{metric.deltaEquivalentShares != null ? <><div>{metric.deltaEquivalentShares.toFixed(1)} 股</div><div className="mt-1">Δ 暴露 ≈ {metric.deltaAdjustedExposure != null ? formatMoney(metric.deltaAdjustedExposure) : '待标的现价'}</div></> : '—'}</td>
      <td className="px-3 py-2 text-right"><button onClick={() => onDelete(holding.id)} className="text-xs text-rose-600 hover:underline" aria-label={`删除 ${holding.symbol}`}>删除</button></td>
    </tr>
  );
}

function quoteSourceLabel(source: string): string {
  const labels: Record<string, string> = {
    finnhub: 'Finnhub',
    fmp: 'FMP',
    alphavantage: 'Alpha Vantage',
    proxy: '代理',
    delta_estimate: 'Delta 估算',
  };
  return labels[source] ?? source;
}
