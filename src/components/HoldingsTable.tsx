import { useState } from 'react';
import type { AssetType, Currency, DisplayCurrency, ExchangeRates, Holding, HoldingMetric } from '../types';
import { formatPct, formatSignedPct } from '../format';
import { CASH_EQUIVALENT_SYMBOLS, isCashEquivalent } from '../assetClass';
import { formatDisplayMoney } from '../displayCurrency';
import { sortHoldingMetrics } from '../metrics';
import { leverageFactorFor } from '../leverageMap';

interface HoldingsTableProps {
  metrics: HoldingMetric[];
  onUpdate: (id: string, patch: Partial<Holding>) => void;
  onDelete: (id: string) => void;
  onAdd: (holding: Omit<Holding, 'id'>) => void;
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
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

export function HoldingsTable({ metrics, onUpdate, onDelete, onAdd, displayCurrency, rates }: HoldingsTableProps) {
  const [draft, setDraft] = useState<Omit<Holding, 'id'>>(emptyDraft);
  const sortedMetrics = sortHoldingMetrics(metrics);

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
        <p className="mb-2 text-xs text-ink-muted">更适合补充现金、少量持仓，或修正 AI 截图识别结果。期权建议同时上传合约详情页，才能计算 Delta 等效正股。</p>
        <form onSubmit={submit} className="grid grid-cols-2 gap-2 rounded-xl border border-neutral/40 bg-surface-raised p-3 sm:grid-cols-4 lg:grid-cols-8">
          <input required placeholder="代码 AAPL" value={draft.symbol} onChange={(event) => setDraft({ ...draft, symbol: event.target.value })} className={inputCls} />
          <input placeholder="名称" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={inputCls} />
          <select value={draft.assetType} onChange={(event) => setDraft({ ...draft, assetType: event.target.value as AssetType })} className={inputCls}>
            {ASSET_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
          <select value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value as Currency })} className={inputCls}>
            {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </select>
          <input type="number" step="any" min={0} placeholder={draft.assetType === 'option' ? '合约张数' : '股数'} value={draft.shares || ''} onChange={(event) => setDraft({ ...draft, shares: Number(event.target.value) })} className={`${inputCls} font-mono tabular-nums`} />
          <input type="number" step="any" min={0} placeholder="买入价" value={draft.buyPrice || ''} onChange={(event) => setDraft({ ...draft, buyPrice: Number(event.target.value) })} className={`${inputCls} font-mono tabular-nums`} />
          <input type="number" step="any" min={0} placeholder="当前价" value={draft.currentPrice || ''} onChange={(event) => setDraft({ ...draft, currentPrice: Number(event.target.value) })} className={`${inputCls} font-mono tabular-nums`} />
          <select value={draft.sector} onChange={(event) => setDraft({ ...draft, sector: event.target.value })} className={inputCls}>
            <option value="">行业</option>
            {SECTOR_PRESETS.map((sector) => <option key={sector} value={sector}>{sector}</option>)}
          </select>
          <label className="col-span-2 flex min-h-11 items-center gap-2 text-xs text-ink-secondary sm:col-span-4 lg:col-span-8">
            <input
              type="checkbox"
              checked={draft.cashEquivalent === true || CASH_EQUIVALENT_SYMBOLS.has(draft.symbol.trim().toUpperCase())}
              onChange={(event) => setDraft({ ...draft, cashEquivalent: event.target.checked })}
              className="accent-buy"
            />
            现金等价物
          </label>
          <button type="submit" className="col-span-2 min-h-11 rounded-md bg-buy px-3 py-2 text-sm font-medium text-surface-base hover:bg-buy/90 sm:col-span-4 lg:col-span-8">添加持仓</button>
        </form>
      </div>

      {metrics.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral/60 p-6 text-center text-sm text-ink-muted">
          尚无持仓。上传券商截图，或在上方手动添加第一笔持仓。
        </div>
      ) : (
        <>
          <section aria-label="移动端持仓列表" className="space-y-2 md:hidden">
            {sortedMetrics.map((metric) => (
              <RowEditor
                key={metric.holding.id}
                layout="mobile"
                metric={metric}
                onUpdate={onUpdate}
                onDelete={onDelete}
                displayCurrency={displayCurrency}
                rates={rates}
              />
            ))}
          </section>
          <div aria-label="桌面端持仓表" className="hidden overflow-x-auto rounded-xl border border-neutral/40 bg-surface-raised md:block">
            <table className="min-w-[1050px] divide-y divide-neutral/40 text-sm">
              <thead className="sticky top-0 z-10 bg-surface-raised text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <Th>代码 / 类型</Th><Th>名称 / 行业</Th><Th className="text-right">数量</Th><Th className="text-right">买入价</Th><Th className="text-right">当前价 / 市值（{displayCurrency}）</Th><Th className="text-right">今日（{displayCurrency}）</Th><Th className="text-right">市值（{displayCurrency}）/ 占比</Th><Th className="text-right">盈亏（{displayCurrency}）</Th><Th>期权等效正股</Th><Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral/30">
                {sortedMetrics.map((metric) => (
                  <RowEditor
                    key={metric.holding.id}
                    layout="desktop"
                    metric={metric}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                    displayCurrency={displayCurrency}
                    rates={rates}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const inputCls = 'min-h-11 rounded-md border border-neutral/60 bg-surface-base px-2 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted focus:border-buy focus:outline-none';

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 text-left ${className ?? ''}`}>{children}</th>;
}

interface RowEditorProps {
  layout: 'mobile' | 'desktop';
  metric: HoldingMetric;
  onUpdate: (id: string, patch: Partial<Holding>) => void;
  onDelete: (id: string) => void;
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
}

function RowEditor({ layout, metric, onUpdate, onDelete, displayCurrency, rates }: RowEditorProps) {
  const { holding } = metric;
  const pnlClass = metric.pnl > 0 ? 'text-gain' : metric.pnl < 0 ? 'text-loss' : 'text-ink-muted';
  const dayClass = metric.dayChange > 0 ? 'text-gain' : metric.dayChange < 0 ? 'text-loss' : 'text-ink-muted';
  const isOption = holding.assetType === 'option';
  const needsPnlCheck = holding.missingFields?.includes('成本待核对') ?? false;
  const label = ASSET_TYPES.find((type) => type.value === (holding.assetType ?? 'stock'))?.label ?? '股票';
  const optionDescription = holding.option
    ? `${holding.option.underlying} ${holding.option.optionType.toUpperCase()} ${holding.option.strike ?? '—'} · ${holding.option.expiration ?? '到期日待补'}`
    : '';

  const pnlContent = metric.costKnown
    ? (
        <>
          <div>{formatDisplayMoney(metric.pnl, displayCurrency, rates)}</div>
          <div className="text-xs">{formatSignedPct(metric.pnlPct)}</div>
        </>
      )
    : <div className="text-xs text-trim">成本待补</div>;
  const dayChangeContent = holding.quote?.change != null
    ? (
        <>
          <div>{formatDisplayMoney(metric.dayChange, displayCurrency, rates)}</div>
          <div className="text-xs">{metric.dayChangePct != null ? formatSignedPct(metric.dayChangePct) : '涨跌率待补'}</div>
          <div className="text-xs text-ink-muted">{quoteSourceLabel(holding.quote.source)}</div>
        </>
      )
    : <div className="text-xs text-ink-muted">未同步</div>;
  const deltaContent = metric.deltaEquivalentShares != null
    ? (
        <>
          <div>{metric.deltaEquivalentShares.toFixed(1)} 股</div>
          <div className="mt-1">Δ 暴露 ≈ {metric.deltaAdjustedExposure != null ? formatDisplayMoney(metric.deltaAdjustedExposure, displayCurrency, rates) : '待标的现价'}</div>
        </>
      )
    : '—';

  if (layout === 'mobile') {
    return (
      <article className="min-w-0 rounded-xl border border-neutral/40 bg-surface-raised p-4">
        <div className="grid min-w-0 grid-cols-4 gap-2 border-b border-neutral/30 pb-3">
          <div className="min-w-0">
            <div className="truncate font-semibold" title={holding.symbol}>{holding.symbol}</div>
            <div className="truncate text-[10px] text-ink-muted">{label} · {holding.currency}</div>
          </div>
          <MobileHeadlineMetric label={isOption ? '张数' : '数量'} value={String(holding.shares)} />
          <MobileHeadlineMetric label="市值" value={formatDisplayMoney(metric.marketValue, displayCurrency, rates)} />
          <div className={`min-w-0 text-right font-mono tabular-nums ${pnlClass}`}>
            <div className="text-[10px] text-ink-muted">盈亏</div>
            {needsPnlCheck && <span className="mr-1 text-trim" title="盈亏与券商截图不符，请核对买入价/股数">⚠</span>}
            <div className="break-all text-[11px] leading-tight">{pnlContent}</div>
          </div>
        </div>

        <div className="mt-3 grid min-w-0 grid-cols-2 gap-2">
          <MobileEditField label="名称">
            <input value={holding.name} onChange={(event) => onUpdate(holding.id, { name: event.target.value })} className={mobileInputCls} placeholder="名称" />
          </MobileEditField>
          <MobileEditField label="行业">
            <input value={holding.sector} onChange={(event) => onUpdate(holding.id, { sector: event.target.value })} className={mobileInputCls} placeholder="行业" />
          </MobileEditField>
          <MobileEditField label={isOption ? '合约张数' : '股数'}>
            <input type="number" step="any" value={holding.shares} onChange={(event) => onUpdate(holding.id, { shares: Number(event.target.value), marketValueOverride: undefined, costOverride: undefined })} className={`${mobileInputCls} text-right font-mono tabular-nums`} />
          </MobileEditField>
          <MobileEditField label={`买入价（${holding.currency}）`}>
            <input type="number" step="any" value={holding.buyPrice} onChange={(event) => onUpdate(holding.id, { buyPrice: Number(event.target.value), costOverride: undefined })} className={`${mobileInputCls} text-right font-mono tabular-nums`} />
          </MobileEditField>
          <MobileEditField label={`当前价（${holding.currency}）`}>
            <input type="number" step="any" value={holding.currentPrice} onChange={(event) => onUpdate(holding.id, { currentPrice: Number(event.target.value), marketValueOverride: undefined })} className={`${mobileInputCls} text-right font-mono tabular-nums`} />
          </MobileEditField>
          <div className={`min-w-0 rounded-lg border border-neutral/30 bg-surface-base px-3 py-2 text-right font-mono tabular-nums ${dayClass}`}>
            <div className="text-left text-[10px] text-ink-muted">今日（{displayCurrency}）</div>
            {dayChangeContent}
          </div>
        </div>

        <div className="mt-2 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          {holding.broker && <span className="rounded bg-surface-overlay px-1.5 py-0.5 text-[10px] font-semibold text-ink-secondary">{brokerLabel(holding.broker)}</span>}
          <label className="flex min-h-11 items-center gap-1">
            <input type="checkbox" checked={isCashEquivalent(holding)} onChange={(event) => onUpdate(holding.id, { cashEquivalent: event.target.checked })} className="accent-buy" />
            现金等价物
          </label>
          {holding.assetType === 'leveraged_etf' && (
            <label className="flex min-h-11 items-center">
              杠杆倍数
              <input type="number" min={0.5} max={5} step={0.1} value={holding.leverageFactor ?? ''} placeholder={String(leverageFactorFor(holding))} onChange={(event) => onUpdate(holding.id, { leverageFactor: event.target.value === '' ? undefined : Number(event.target.value) })} className="ml-1 min-h-11 w-16 rounded border border-neutral/60 bg-surface-base px-2 text-right font-mono tabular-nums text-ink-primary" />
            </label>
          )}
        </div>

        {optionDescription && <div className="font-mono text-xs tabular-nums text-ink-muted">{optionDescription}</div>}
        {holding.missingFields && holding.missingFields.length > 0 && <div className="mt-1 text-xs text-trim">待补：{holding.missingFields.join('、')}</div>}
        {holding.quote?.note && <div className="mt-1 text-xs text-ink-secondary">{holding.quote.note}</div>}
        <div className="mt-2 font-mono text-xs tabular-nums text-ink-secondary">{deltaContent}</div>

        <div className="mt-2 flex items-center justify-between border-t border-neutral/30 pt-2">
          <div className="font-mono text-xs tabular-nums text-ink-muted">
            占比 {formatPct(metric.weight)}
          </div>
          <button onClick={() => onDelete(holding.id)} className="min-h-11 min-w-11 px-2 text-xs text-loss hover:underline" aria-label={`删除 ${holding.symbol}`}>删除</button>
        </div>
      </article>
    );
  }

  return (
    <tr className="align-top hover:bg-surface-overlay/50">
      <td className="px-3 py-2.5"><div className="font-medium">{holding.symbol}</div><div className="font-mono text-xs tabular-nums text-ink-muted">{label} · {holding.currency}</div>{holding.broker && <span className="mt-1 inline-block rounded bg-surface-overlay px-1.5 py-0.5 text-[10px] font-semibold text-ink-secondary">{brokerLabel(holding.broker)}</span>}{holding.assetType === 'leveraged_etf' && <label className="mt-1 block text-xs text-ink-muted">杠杆倍数 <input type="number" min={0.5} max={5} step={0.1} value={holding.leverageFactor ?? ''} placeholder={String(leverageFactorFor(holding))} onChange={(event) => onUpdate(holding.id, { leverageFactor: event.target.value === '' ? undefined : Number(event.target.value) })} className="ml-1 w-14 rounded border border-neutral/60 bg-transparent px-1 py-0.5 text-right font-mono tabular-nums" /></label>}{optionDescription && <div className="mt-1 max-w-44 font-mono text-xs tabular-nums text-ink-muted">{optionDescription}</div>}</td>
      <td className="px-3 py-2.5"><input value={holding.name} onChange={(event) => onUpdate(holding.id, { name: event.target.value })} className="w-28 bg-transparent text-ink-primary focus:outline-none" placeholder="名称" /><input value={holding.sector} onChange={(event) => onUpdate(holding.id, { sector: event.target.value })} className="mt-1 w-24 bg-transparent text-xs text-ink-muted focus:outline-none" placeholder="行业" /><label className="mt-1 flex items-center gap-1 text-xs text-ink-muted"><input type="checkbox" checked={isCashEquivalent(holding)} onChange={(event) => onUpdate(holding.id, { cashEquivalent: event.target.checked })} className="accent-buy" />现金等价物</label>{holding.missingFields && holding.missingFields.length > 0 && <div className="mt-1 max-w-36 text-xs text-trim">待补：{holding.missingFields.join('、')}</div>}{holding.quote?.note && <div className="mt-1 max-w-44 text-xs text-ink-secondary">{holding.quote.note}</div>}</td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums"><input type="number" step="any" value={holding.shares} onChange={(event) => onUpdate(holding.id, { shares: Number(event.target.value), marketValueOverride: undefined, costOverride: undefined })} className="w-20 bg-transparent text-right font-mono tabular-nums focus:outline-none" /><div className="text-xs text-ink-muted">{isOption ? '合约张数' : '股'}</div></td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums"><input type="number" step="any" value={holding.buyPrice} onChange={(event) => onUpdate(holding.id, { buyPrice: Number(event.target.value), costOverride: undefined })} className="w-20 bg-transparent text-right font-mono tabular-nums focus:outline-none" /><div className="text-xs text-ink-muted">{holding.currency}</div></td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums"><input type="number" step="any" value={holding.currentPrice} onChange={(event) => onUpdate(holding.id, { currentPrice: Number(event.target.value), marketValueOverride: undefined })} className="w-20 bg-transparent text-right font-mono tabular-nums focus:outline-none" /><div className="mt-1 text-xs font-medium">{formatDisplayMoney(metric.marketValue, displayCurrency, rates)}</div></td>
      <td className={`px-3 py-2.5 text-right font-mono tabular-nums ${dayClass}`}>{dayChangeContent}</td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums"><div>{formatDisplayMoney(metric.marketValue, displayCurrency, rates)}</div><div className="text-xs text-ink-muted">{formatPct(metric.weight)}</div></td>
      <td className={`px-3 py-2.5 text-right font-mono tabular-nums ${pnlClass}`}>
        {needsPnlCheck && <span className="mr-1 text-trim" title="盈亏与券商截图不符，请核对买入价/股数">⚠</span>}
        {pnlContent}
      </td>
      <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-ink-secondary">{deltaContent}</td>
      <td className="px-3 py-2.5 text-right"><button onClick={() => onDelete(holding.id)} className="text-xs text-loss hover:underline" aria-label={`删除 ${holding.symbol}`}>删除</button></td>
    </tr>
  );
}

const mobileInputCls = 'min-h-11 w-full min-w-0 rounded-lg border border-neutral/60 bg-surface-base px-3 py-2 text-sm text-ink-primary placeholder:text-ink-muted focus:border-buy focus:outline-none';

function MobileEditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="min-w-0 text-[10px] text-ink-muted">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function MobileHeadlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 text-right font-mono tabular-nums">
      <div className="text-[10px] text-ink-muted">{label}</div>
      <div className="break-all text-[11px] leading-tight text-ink-primary">{value}</div>
    </div>
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

function brokerLabel(broker: string): string {
  const normalized = broker.trim().toUpperCase();
  if (normalized === 'LONGBRIDGE') return 'LONGPORT';
  return normalized;
}
