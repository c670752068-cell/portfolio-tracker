import { useMemo, useState } from 'react';
import { formatDisplayMoney } from '../displayCurrency';
import { formatSignedPct } from '../format';
import { listScenarioFamilies, simulateScenario, type ScenarioKind } from '../scenario';
import type { DisplayCurrency, ExchangeRates, PortfolioMetrics } from '../types';

interface ScenarioCalculatorProps {
  metrics: PortfolioMetrics;
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
}

const PRICE_STEPS = [-0.2, -0.1, 0.1, 0.2, 0.3];
const DAY_STEPS = [10, 15, 30];

export function ScenarioCalculator({ metrics, displayCurrency, rates }: ScenarioCalculatorProps) {
  const families = useMemo(() => listScenarioFamilies(metrics.holdingsMetrics), [metrics.holdingsMetrics]);
  const [family, setFamily] = useState('');
  const [target, setTarget] = useState({ key: '', value: 0 });
  const [days, setDays] = useState(0);
  const selected = families.find((item) => item.symbol === family) ?? families[0];
  const selectedKey = selected ? `${selected.symbol}:${selected.spot}` : '';
  const targetPrice = selected && target.key === selectedKey ? target.value : selected?.spot ?? 0;
  const setTargetPrice = (value: number) => setTarget({ key: selectedKey, value });

  const result = useMemo(() => {
    if (!selected) return null;
    return simulateScenario({
      family: selected.symbol,
      holdings: metrics.holdingsMetrics,
      spot: selected.spot,
      targetPrice,
      days,
      totalAssets: metrics.totalValue,
    });
  }, [days, metrics.holdingsMetrics, metrics.totalValue, selected, targetPrice]);

  if (!selected) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
        暂无可计算标的。请先同步持仓，或补充正股现价 / 期权标的现价。
      </div>
    );
  }

  const totalClass = result && result.totalPnl > 0 ? 'text-emerald-600' : result && result.totalPnl < 0 ? 'text-rose-600' : 'text-slate-600';
  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-base font-semibold">持仓情景计算器</h2>
        <p className="mt-1 text-xs text-slate-500">设定底层标的目标价与经过天数，合并估算同族正股、杠杆 ETF 与期权盈亏。</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium">底层标的</span>
            <select
              value={selected.symbol}
              onChange={(event) => {
                const next = families.find((item) => item.symbol === event.target.value);
                setFamily(event.target.value);
                if (next) setTarget({ key: `${next.symbol}:${next.spot}`, value: next.spot });
              }}
              className={inputClass}
            >
              {families.map((item) => <option key={item.symbol} value={item.symbol}>{item.symbol} · 现价 {item.spot.toFixed(2)}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">目标价</span>
            <input type="number" min={0} step="any" value={targetPrice || ''} onChange={(event) => setTargetPrice(Number(event.target.value))} className={inputClass} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">经过天数</span>
            <input type="number" min={0} step={1} value={days} onChange={(event) => setDays(Math.max(0, Number(event.target.value)))} className={inputClass} />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">目标价快捷：</span>
          {PRICE_STEPS.map((step) => (
            <button key={step} type="button" onClick={() => setTargetPrice(roundPrice(selected.spot * (1 + step)))} className={chipClass}>
              {step > 0 ? '+' : '−'}{Math.abs(step * 100)}%
            </button>
          ))}
          <span className="ml-2 text-xs text-slate-500">天数：</span>
          {DAY_STEPS.map((value) => <button key={value} type="button" onClick={() => setDays(value)} className={chipClass}>{value} 天</button>)}
        </div>
      </div>

      {result && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">{selected.symbol}：{selected.spot.toFixed(2)} → {targetPrice.toFixed(2)}</h3>
            <span className="text-xs text-slate-500">{formatSignedPct(targetPrice / selected.spot - 1)} · {days} 天</span>
          </div>
          {result.lines.length > 0 ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {result.lines.map((line) => {
                const pnlClass = line.pnl > 0 ? 'text-emerald-600' : line.pnl < 0 ? 'text-rose-600' : 'text-slate-500';
                return (
                  <div key={line.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{line.name}</div>
                      <div className="text-xs text-slate-500">{line.symbol} · {kindLabel(line.kind)}</div>
                    </div>
                    <div className={`text-right tabular-nums ${pnlClass}`}>
                      <div>{formatDisplayMoney(line.pnl, displayCurrency, rates)}</div>
                      <div className="text-xs">{formatSignedPct(line.pnlPct)}</div>
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-between gap-3 pt-3 text-sm font-semibold">
                <span>合计情景盈亏</span>
                <span className={`text-right tabular-nums ${totalClass}`}>
                  <span className="block">{formatDisplayMoney(result.totalPnl, displayCurrency, rates)}</span>
                  <span className="block text-xs font-medium">占总资产 {formatSignedPct(result.totalPnlPctOfAssets)}</span>
                </span>
              </div>
            </div>
          ) : (
            <div className="py-3 text-sm text-slate-500">该标的暂无可参与计算的持仓。</div>
          )}
          {result.excluded.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
              {result.excluded.length} 个期权缺 Delta 未计入——用「补充期权详情」导入后即可参与计算。
            </div>
          )}
          <div className="mt-3 space-y-1 text-xs text-slate-500">
            <p>杠杆 ETF 按一次性变动近似，未建模逐日损耗。</p>
            <p>期权不含隐含波动率变化，Delta/Gamma/Theta 取自最近一次期权详情导入。</p>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
        近似估算：杠杆按一次变动、期权按希腊字母泰勒展开，不含 IV 变化与路径损耗；仅供心态与仓位推演，不构成建议。
      </div>
    </section>
  );
}

function kindLabel(kind: ScenarioKind): string {
  if (kind === 'leveraged_etf') return '杠杆 ETF';
  if (kind === 'option') return '期权';
  return '正股 / 普通 ETF';
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

const inputClass = 'w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900';
const chipClass = 'rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-700';
