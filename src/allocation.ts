import type { PortfolioMetrics } from './types';
import { isCashEquivalent } from './assetClass';

export interface AllocationSlice {
  name: string;
  value: number;
  weight: number;
  showLabel: boolean;
  kind: 'asset' | 'other' | 'cash' | 'cash-equivalent';
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
  for (const metric of metrics.holdingsMetrics) {
    if (isCashEquivalent(metric.holding)) continue;
    const symbol = metric.holding.symbol || metric.holding.name || '未命名';
    bySymbol.set(symbol, (bySymbol.get(symbol) ?? 0) + metric.marketValue);
  }
  const ranked = [...bySymbol.entries()]
    .map(([name, value]) => ({ name, value, kind: 'asset' as const }))
    .sort((left, right) => right.value - left.value);
  const safeMaxSlices = Math.max(1, Math.floor(maxSlices));
  const visible = ranked.length > safeMaxSlices
    ? [
        ...ranked.slice(0, safeMaxSlices - 1),
        {
          name: `其他（${ranked.length - (safeMaxSlices - 1)} 项）`,
          value: ranked.slice(safeMaxSlices - 1).reduce((sum, slice) => sum + slice.value, 0),
          kind: 'other' as const,
        },
      ]
    : ranked;
  const base: Array<Pick<AllocationSlice, 'name' | 'value' | 'kind'>> = [...visible];
  if (metrics.cashEquivalentValue > 0) {
    base.push({ name: '现金类 ETF(SGOV等)', value: metrics.cashEquivalentValue, kind: 'cash-equivalent' });
  }
  if (metrics.cashValue > 0) {
    base.push({ name: '现金', value: metrics.cashValue, kind: 'cash' });
  }
  return base.map((slice) => {
    const weight = metrics.totalValue > 0 ? slice.value / metrics.totalValue : 0;
    return { ...slice, weight, showLabel: weight >= labelMinWeight };
  });
}
