import type { PortfolioMetrics, QuantAnalysisSnapshot } from './types';
import { isCashEquivalent } from './assetClass';
import { leverageFactorFor, leverageUnderlyingFor, leverageUnderlyingForSymbol } from './leverageMap';

export interface AllocationSlice {
  name: string;
  value: number;
  weight: number;
  navWeight: number;
  showLabel: boolean;
  kind: 'asset' | 'other' | 'option' | 'cash' | 'cash-equivalent';
  estimated?: boolean;
}

export const OPTION_BUDGET_CAPS = {
  total: 0.05,
  tqqq: 0.03,
  other: 0.02,
} as const;

export interface OptionBudgetLine {
  value: number;
  weight: number;
  cap: number;
  limitValue: number;
  remainingValue: number;
  overByValue: number;
  overLimit: boolean;
}

export interface OptionBudgetSummary {
  total: OptionBudgetLine;
  tqqq: OptionBudgetLine;
  other: OptionBudgetLine;
  hasOverLimit: boolean;
}

interface AllocationOptions {
  maxSlices?: number;
  labelMinWeight?: number;
}

export function buildAllocationSlices(
  metrics: PortfolioMetrics,
  { maxSlices = 12, labelMinWeight = 0.03 }: AllocationOptions = {},
): AllocationSlice[] {
  const bySymbol = new Map<string, number>();
  let optionValue = 0;
  for (const metric of metrics.holdingsMetrics) {
    if (isCashEquivalent(metric.holding)) continue;
    if (metric.holding.assetType === 'option') {
      optionValue += Math.abs(metric.marketValue);
      continue;
    }
    const symbol = metric.holding.symbol || metric.holding.name || '未命名';
    bySymbol.set(symbol, (bySymbol.get(symbol) ?? 0) + metric.marketValue);
  }
  const ranked = [...bySymbol.entries()]
    .map(([name, value]) => ({ name, value, kind: 'asset' as const }))
    .sort((left, right) => right.value - left.value);
  const safeMaxSlices = Math.max(1, Math.floor(maxSlices));
  const assetSliceLimit = Math.max(1, safeMaxSlices - (optionValue > 0 ? 1 : 0));
  const visible = ranked.length > assetSliceLimit
    ? [
        ...ranked.slice(0, assetSliceLimit - 1),
        {
          name: `其他（${ranked.length - (assetSliceLimit - 1)} 项）`,
          value: ranked.slice(assetSliceLimit - 1).reduce((sum, slice) => sum + slice.value, 0),
          kind: 'other' as const,
        },
      ]
    : ranked;
  const base: Array<Pick<AllocationSlice, 'name' | 'value' | 'kind'>> = [...visible];
  if (optionValue > 0) {
    base.push({ name: '期权（总计）', value: optionValue, kind: 'option' });
  }
  if (metrics.cashEquivalentValue > 0) {
    base.push({ name: '现金类 ETF(SGOV等)', value: metrics.cashEquivalentValue, kind: 'cash-equivalent' });
  }
  if (metrics.cashValue > 0) {
    base.push({ name: '现金', value: metrics.cashValue, kind: 'cash' });
  }
  return base.map((slice) => {
    const weight = metrics.totalValue > 0 ? slice.value / metrics.totalValue : 0;
    return { ...slice, weight, navWeight: weight, showLabel: weight >= labelMinWeight };
  });
}

/**
 * Tracks gross option premium/current market value against the NAV budget.
 * Absolute values keep short option marks from cancelling long-option usage;
 * TQQQ shares and TQQQ ETF holdings are intentionally excluded.
 */
export function buildOptionBudget(metrics: PortfolioMetrics): OptionBudgetSummary {
  let tqqqValue = 0;
  let otherValue = 0;

  for (const metric of metrics.holdingsMetrics) {
    if (metric.holding.assetType !== 'option') continue;
    const value = Math.abs(metric.marketValue);
    const underlying = normalizeOptionUnderlying(
      metric.holding.option?.underlying || metric.holding.symbol,
    );
    if (underlying === 'TQQQ') tqqqValue += value;
    else otherValue += value;
  }

  const total = optionBudgetLine(tqqqValue + otherValue, metrics.totalValue, OPTION_BUDGET_CAPS.total);
  const tqqq = optionBudgetLine(tqqqValue, metrics.totalValue, OPTION_BUDGET_CAPS.tqqq);
  const other = optionBudgetLine(otherValue, metrics.totalValue, OPTION_BUDGET_CAPS.other);
  return {
    total,
    tqqq,
    other,
    hasOverLimit: total.overLimit || tqqq.overLimit || other.overLimit,
  };
}

function optionBudgetLine(value: number, nav: number, cap: number): OptionBudgetLine {
  const safeNav = Number.isFinite(nav) && nav > 0 ? nav : 0;
  const limitValue = safeNav * cap;
  const difference = value - limitValue;
  const overLimit = difference > 0.005;
  return {
    value,
    weight: safeNav > 0 ? value / safeNav : 0,
    cap,
    limitValue,
    remainingValue: overLimit ? 0 : Math.max(0, -difference),
    overByValue: overLimit ? difference : 0,
    overLimit,
  };
}

function normalizeOptionUnderlying(value: string): string {
  return value.trim().toUpperCase().replace(/^US\./, '');
}

/**
 * Builds gross, delta-adjusted risk exposure by underlying family.
 * Cash and cash-equivalent ETFs do not carry equity exposure. When the quant
 * snapshot supplies option Delta notionals, it is authoritative for options;
 * otherwise locally entered Delta values are used as a fallback.
 */
export function buildEffectiveExposureSlices(
  metrics: PortfolioMetrics,
  snapshot: QuantAnalysisSnapshot | null,
  { maxSlices = 12, labelMinWeight = 0.03 }: AllocationOptions = {},
): AllocationSlice[] {
  const byFamily = new Map<string, { value: number; estimated: boolean }>();
  const add = (name: string, value: number, estimated = false) => {
    if (!name || !Number.isFinite(value) || value <= 0) return;
    const current = byFamily.get(name) ?? { value: 0, estimated: false };
    byFamily.set(name, {
      value: current.value + value,
      estimated: current.estimated || estimated,
    });
  };

  for (const metric of metrics.holdingsMetrics) {
    const holding = metric.holding;
    if (holding.assetType === 'option' || isCashEquivalent(holding)) continue;
    const family = holding.assetType === 'leveraged_etf'
      ? leverageUnderlyingFor(holding) || `${holding.symbol}（${leverageFactorFor(holding)}×）`
      : holding.symbol;
    add(family.trim().toUpperCase(), Math.abs(metric.equivalentExposure ?? 0));
  }

  const serverOptions = snapshot?.option_exposure?.items?.filter(
    (item) => typeof item.delta_notional_usd === 'number'
      && Number.isFinite(item.delta_notional_usd)
      && item.delta_notional_usd !== 0,
  ) ?? [];
  if (serverOptions.length > 0) {
    for (const item of serverOptions) {
      const rawFamily = item.family || item.symbol;
      const family = leverageUnderlyingForSymbol(rawFamily) || rawFamily;
      add(
        family.trim().toUpperCase(),
        Math.abs(item.delta_notional_usd ?? 0),
        item.delta_source === 'estimated',
      );
    }
  } else {
    for (const metric of metrics.holdingsMetrics) {
      if (metric.holding.assetType !== 'option') continue;
      const rawFamily = metric.holding.option?.underlying || metric.holding.symbol;
      const family = leverageUnderlyingForSymbol(rawFamily) || rawFamily;
      add(family.trim().toUpperCase(), Math.abs(metric.deltaAdjustedExposure ?? 0));
    }
  }

  const ranked = [...byFamily.entries()]
    .map(([name, item]) => ({ name, ...item, kind: 'asset' as const }))
    .sort((left, right) => right.value - left.value);
  const safeMaxSlices = Math.max(1, Math.floor(maxSlices));
  const visible = ranked.length > safeMaxSlices
    ? [
        ...ranked.slice(0, safeMaxSlices - 1),
        {
          name: `其他（${ranked.length - (safeMaxSlices - 1)} 项）`,
          value: ranked.slice(safeMaxSlices - 1).reduce((sum, slice) => sum + slice.value, 0),
          estimated: ranked.slice(safeMaxSlices - 1).some((slice) => slice.estimated),
          kind: 'other' as const,
        },
      ]
    : ranked;
  const totalExposure = visible.reduce((sum, slice) => sum + slice.value, 0);
  return visible.map((slice) => {
    const weight = totalExposure > 0 ? slice.value / totalExposure : 0;
    const navWeight = metrics.totalValue > 0 ? slice.value / metrics.totalValue : 0;
    return {
      ...slice,
      weight,
      navWeight,
      showLabel: weight >= labelMinWeight,
    };
  });
}
