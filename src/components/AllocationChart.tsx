import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { DisplayCurrency, ExchangeRates, PortfolioMetrics, QuantAnalysisSnapshot } from '../types';
import { formatPct } from '../format';
import {
  buildAllocationSlices,
  buildEffectiveExposureSlices,
  buildOptionBudget,
  type AllocationSlice,
  type OptionBudgetLine,
} from '../allocation';
import { formatDisplayMoney } from '../displayCurrency';

const COLORS = [
  'var(--color-buy)', 'var(--color-gain)', 'var(--color-trim)', 'var(--color-loss)',
  'color-mix(in srgb, var(--color-buy) 72%, var(--color-neutral))',
  'color-mix(in srgb, var(--color-gain) 72%, var(--color-neutral))',
  'color-mix(in srgb, var(--color-trim) 72%, var(--color-neutral))',
  'color-mix(in srgb, var(--color-loss) 72%, var(--color-neutral))',
  'color-mix(in srgb, var(--color-buy) 48%, var(--color-ink-muted))',
  'color-mix(in srgb, var(--color-gain) 48%, var(--color-ink-muted))',
  'color-mix(in srgb, var(--color-trim) 48%, var(--color-ink-muted))',
  'color-mix(in srgb, var(--color-loss) 48%, var(--color-ink-muted))',
];

interface AllocationChartProps {
  metrics: PortfolioMetrics;
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
  analysisSnapshot?: QuantAnalysisSnapshot | null;
}

export function AllocationChart({ metrics, displayCurrency, rates, analysisSnapshot = null }: AllocationChartProps) {
  const [mode, setMode] = useState<'market' | 'effective'>('market');
  const effective = mode === 'effective';
  const slices = effective
    ? buildEffectiveExposureSlices(metrics, analysisSnapshot)
    : buildAllocationSlices(metrics);
  const detailSlices = [...slices].sort((left, right) => right.value - left.value);
  const totalExposure = slices.reduce((sum, slice) => sum + slice.value, 0);
  const totalExposurePct = metrics.totalValue > 0 ? totalExposure / metrics.totalValue : 0;
  const hasEstimatedOptions = effective && slices.some((slice) => slice.estimated);
  const optionBudget = buildOptionBudget(metrics);

  if (slices.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-ink-muted">
        添加持仓或现金后，这里将显示占比饼图。
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-relaxed text-ink-muted">
            {effective
              ? '按底层风险合并；杠杆 ETF 乘杠杆倍数，期权按 Delta 折算。'
              : '按当前市值计算，包含现金与现金类 ETF。'}
          </p>
          {totalExposure > 0 && (
            <p className="mt-1 text-sm font-semibold tabular-nums text-ink-primary">
              {effective
                ? `总等效敞口 ${formatDisplayMoney(totalExposure, displayCurrency, rates)} · 占净值 ${formatPct(totalExposurePct)}`
                : `总实际市值 ${formatDisplayMoney(totalExposure, displayCurrency, rates)}`}
            </p>
          )}
        </div>
        <div className="inline-flex shrink-0 rounded-lg border border-neutral/40 bg-surface-overlay p-1" role="group" aria-label="资产占比口径">
          <button
            type="button"
            aria-pressed={!effective}
            onClick={() => setMode('market')}
            className={`min-h-9 rounded-md px-3 text-xs font-semibold transition-colors ${!effective ? 'bg-surface-raised text-ink-primary shadow-sm' : 'text-ink-muted'}`}
          >
            实际市值
          </button>
          <button
            type="button"
            aria-pressed={effective}
            onClick={() => setMode('effective')}
            className={`min-h-9 rounded-md px-3 text-xs font-semibold transition-colors ${effective ? 'bg-surface-raised text-ink-primary shadow-sm' : 'text-ink-muted'}`}
          >
            等效敞口
          </button>
        </div>
      </div>
      <OptionBudgetPanel
        budget={optionBudget}
        nav={metrics.totalValue}
        displayCurrency={displayCurrency}
        rates={rates}
      />
      <div className="h-56 min-w-0 sm:h-96" data-allocation-chart="true">
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 640, height: 384 }}
        >
          <PieChart margin={{ top: 24, right: 24, bottom: 24, left: 24 }} className="tabular-nums">
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="45%"
              outerRadius="72%"
              paddingAngle={2}
              label={false}
            >
              {slices.map((s, i) => (
                <Cell key={`${i}-${s.name}`} fill={sliceColor(s, i)} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, _name, item) => {
                const slice = item.payload as AllocationSlice;
                const num = typeof value === 'number' ? value : Number(value);
                const detail = effective
                  ? `占净值 ${formatPct(slice.navWeight)} · 等效占比 ${formatPct(slice.weight)}`
                  : `占净值 ${formatPct(slice.weight)}`;
                return [`${formatDisplayMoney(num, displayCurrency, rates)} · ${detail}`, `${slice.name}${slice.estimated ? '（估算）' : ''}`];
              }}
              contentStyle={{
                backgroundColor: 'var(--color-surface-raised)',
                borderColor: 'color-mix(in srgb, var(--color-neutral) 60%, transparent)',
                borderRadius: '0.75rem',
                color: 'var(--color-ink-primary)',
                fontSize: '0.75rem',
              }}
              labelStyle={{ color: 'var(--color-ink-secondary)' }}
              itemStyle={{ color: 'var(--color-ink-primary)' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-1 divide-y divide-neutral/30 overflow-hidden rounded-xl border border-neutral/30 bg-surface-base px-3 text-xs sm:grid-cols-2 sm:divide-y-0">
        {detailSlices.map((slice) => {
          const index = slices.indexOf(slice);
          return (
            <div key={slice.name} className="flex min-w-0 items-start gap-2 py-2 sm:px-2">
              <span
                className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: sliceColor(slice, index) }}
              />
              <span className="min-w-0 flex-1 break-words leading-tight text-ink-secondary" title={slice.name}>
                {slice.name}
                {slice.estimated && (
                  <span className="ml-1 inline-block rounded bg-neutral/30 px-1 py-0.5 text-[9px] font-medium text-ink-muted">估算</span>
                )}
              </span>
              <span className="shrink-0 text-right font-medium tabular-nums text-ink-primary">
                <span className="block">
                  {effective ? `占净值 ${formatPct(slice.navWeight)}` : formatPct(slice.weight)}
                </span>
                {effective && <span className="block text-[10px] font-normal text-ink-muted">等效占比 {formatPct(slice.weight)}</span>}
                <span className="block text-[10px] font-normal text-ink-muted">{formatDisplayMoney(slice.value, displayCurrency, rates)}</span>
              </span>
            </div>
          );
        })}
      </div>
      {hasEstimatedOptions && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
          标注“估算”的期权使用量化系统提供的统一 Delta 假设，非券商实时 Delta；数值用于观察风险量级。
        </p>
      )}
    </div>
  );
}

function OptionBudgetPanel({
  budget,
  nav,
  displayCurrency,
  rates,
}: {
  budget: ReturnType<typeof buildOptionBudget>;
  nav: number;
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
}) {
  return (
    <section
      className="my-3 rounded-xl border border-neutral/40 bg-surface-overlay/35 p-3"
      aria-label="期权资金预算"
      data-option-budget="true"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold text-ink-primary sm:text-sm">期权资金预算</h3>
          <p className="mt-1 text-[10px] leading-relaxed text-ink-muted sm:text-xs">
            按总资产 {formatDisplayMoney(nav, displayCurrency, rates)} 计算当前期权市值；期权总计最多 5%，其中 TQQQ 期权 3%，个股 / 其他期权 2%。仅作仓位提醒，不自动交易。
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-neutral/25 px-2 py-1 text-[10px] font-medium text-ink-secondary">当前市值口径</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="col-span-2 sm:col-span-1">
          <OptionBudgetCard label="期权总计" line={budget.total} displayCurrency={displayCurrency} rates={rates} />
        </div>
        <OptionBudgetCard label="TQQQ 期权" line={budget.tqqq} displayCurrency={displayCurrency} rates={rates} />
        <OptionBudgetCard label="个股 / 其他期权" line={budget.other} displayCurrency={displayCurrency} rates={rates} />
      </div>
      {budget.hasOverLimit && (
        <div className="mt-3 rounded-lg border border-loss/55 bg-loss/10 px-3 py-2 text-xs font-semibold leading-relaxed text-loss" role="alert">
          期权预算超限：暂停新增期权，先把超限类别降回上限内。
        </div>
      )}
    </section>
  );
}

function OptionBudgetCard({
  label,
  line,
  displayCurrency,
  rates,
}: {
  label: string;
  line: OptionBudgetLine;
  displayCurrency: DisplayCurrency;
  rates: ExchangeRates;
}) {
  const usage = line.cap > 0 ? Math.min(1, line.weight / line.cap) : 0;
  return (
    <div
      className={`rounded-lg border p-2.5 ${line.overLimit ? 'border-loss/55 bg-loss/10' : 'border-neutral/35 bg-surface-raised/70'}`}
      data-option-limit={label === '期权总计' ? 'total' : label === 'TQQQ 期权' ? 'tqqq' : 'other'}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] font-semibold ${line.overLimit ? 'text-loss' : 'text-ink-secondary'}`}>{label}</span>
        {line.overLimit && <span className="rounded-full bg-loss/15 px-1.5 py-0.5 text-[9px] font-bold text-loss">超限</span>}
      </div>
      <p className={`mt-1 text-base font-bold tabular-nums ${line.overLimit ? 'text-loss' : 'text-ink-primary'}`}>
        {formatDisplayMoney(line.value, displayCurrency, rates)}
      </p>
      <p className="mt-0.5 text-[10px] tabular-nums text-ink-secondary">
        占总资产 {formatPct(line.weight)} · 上限 {formatPct(line.cap)}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral/30" aria-hidden="true">
        <span
          className={`block h-full rounded-full ${line.overLimit ? 'bg-loss' : 'bg-gain'}`}
          style={{ width: `${usage * 100}%` }}
        />
      </div>
      <p className={`mt-1 text-[10px] tabular-nums ${line.overLimit ? 'font-semibold text-loss' : 'text-ink-muted'}`}>
        {line.overLimit
          ? `已超出 ${formatDisplayMoney(line.overByValue, displayCurrency, rates)}`
          : `剩余额度 ${formatDisplayMoney(line.remainingValue, displayCurrency, rates)}`}
      </p>
    </div>
  );
}

function sliceColor(slice: AllocationSlice, index: number): string {
  if (slice.kind === 'cash') return 'var(--color-cash)';
  if (slice.kind === 'cash-equivalent') return 'color-mix(in srgb, var(--color-cash) 72%, var(--color-ink-muted))';
  if (slice.kind === 'option') return 'color-mix(in srgb, var(--color-buy) 65%, var(--color-trim))';
  return COLORS[index % COLORS.length];
}
