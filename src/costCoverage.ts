import { isOption } from './assetClass';
import type { Holding, QuantHoldingCost } from './types';

export type CostGapReason = 'option_no_source' | 'equity_no_source' | 'quant_coverage_incomplete' | 'manual_missing';

export interface CostGapRow {
  symbol: string;
  assetType: string;
  broker?: string;
  reason: CostGapReason;
}

export interface CostCoverageAnalysis {
  total: number;
  costed: number;
  gaps: CostGapRow[];
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function analyzeCostCoverage(
  holdings: readonly Holding[],
  holdingCosts: Readonly<Record<string, QuantHoldingCost>>,
): CostCoverageAnalysis {
  const gapsByKey = new Map<string, CostGapRow>();
  let costed = 0;

  for (const holding of holdings) {
    if (isPositiveFinite(holding.costOverride) || isPositiveFinite(holding.buyPrice)) {
      costed += 1;
      continue;
    }

    const symbol = holding.symbol.trim().toUpperCase();
    const assetType = holding.assetType ?? 'other';
    const key = `${symbol}:${holding.broker ?? ''}`;
    if (isOption(holding)) {
      gapsByKey.set(key, { symbol, assetType, broker: holding.broker, reason: 'option_no_source' });
      continue;
    }

    const quantCost = holdingCosts[symbol];
    if (!quantCost || quantCost.coverage === 'unavailable') {
      if (!gapsByKey.has(key)) gapsByKey.set(key, { symbol, assetType, broker: holding.broker, reason: 'equity_no_source' });
      continue;
    }
    if (quantCost.coverage !== 'complete' || !quantCost.auto_fill_allowed) {
      if (!gapsByKey.has(key)) gapsByKey.set(key, { symbol, assetType, broker: holding.broker, reason: 'quant_coverage_incomplete' });
      continue;
    }
    if (isPositiveFinite(quantCost.weighted_average_cost)) {
      costed += 1;
      continue;
    }
    if (!gapsByKey.has(key)) gapsByKey.set(key, { symbol, assetType, broker: holding.broker, reason: 'manual_missing' });
  }

  return { total: holdings.length, costed, gaps: [...gapsByKey.values()] };
}
