import type { Holding, QuantHoldingCost } from './types';

export type FamilyPnlCoverage = 'complete' | 'partial' | 'unavailable';

export interface FamilyPnl {
  marketValue: number;
  costedMarketValue: number;
  uncostedMarketValue: number;
  costBasis: number;
  pnl: number;
  pnlPct: number | null;
  coverage: FamilyPnlCoverage;
  unknownCostHoldings: string[];
}

function normalize(value: string): string {
  return value.trim().toUpperCase();
}

function multiplierFor(holding: Holding): number {
  return holding.assetType === 'option' ? holding.option?.contractMultiplier ?? 100 : 1;
}

function marketValueFor(holding: Holding): number {
  const calculated = holding.shares * holding.currentPrice * multiplierFor(holding);
  const value = holding.marketValueOverride ?? calculated;
  return Number.isFinite(value) ? value : 0;
}

function costBasisFor(
  holding: Holding,
  holdingCosts: Readonly<Record<string, QuantHoldingCost>>,
): number | null {
  if (typeof holding.costOverride === 'number'
    && Number.isFinite(holding.costOverride)
    && holding.costOverride > 0) {
    return holding.costOverride;
  }
  const multiplier = multiplierFor(holding);
  if (Number.isFinite(holding.buyPrice) && holding.buyPrice > 0) {
    return holding.shares * holding.buyPrice * multiplier;
  }
  const external = holding.assetType === 'option'
    ? undefined
    : holdingCosts[normalize(holding.symbol)]?.weighted_average_cost;
  if (typeof external === 'number' && Number.isFinite(external) && external > 0) {
    return holding.shares * external * multiplier;
  }
  return null;
}

function belongsToFamily(holding: Holding, members: ReadonlySet<string>): boolean {
  if (members.has(normalize(holding.symbol))) return true;
  return holding.assetType === 'option'
    && members.has(normalize(holding.option?.underlying || ''));
}

export function computeFamilyPnl(
  holdings: readonly Holding[],
  family: string,
  heldSymbols: readonly string[],
  holdingCosts: Readonly<Record<string, QuantHoldingCost>>,
): FamilyPnl {
  const members = new Set([normalize(family), ...heldSymbols.map(normalize)]);
  const matched = holdings.filter((holding) => belongsToFamily(holding, members));
  let marketValue = 0;
  let costBasis = 0;
  let costedMarketValue = 0;
  let knownCosts = 0;
  const unknownCostCounts = new Map<string, { symbol: string; isOption: boolean; count: number }>();

  for (const holding of matched) {
    const marketValueForHolding = marketValueFor(holding);
    marketValue += marketValueForHolding;
    const cost = costBasisFor(holding, holdingCosts);
    if (cost === null) {
      const symbol = normalize(holding.symbol);
      const isOption = holding.assetType === 'option';
      const key = `${symbol}:${isOption ? 'option' : 'other'}`;
      const existing = unknownCostCounts.get(key);
      unknownCostCounts.set(key, { symbol, isOption, count: (existing?.count ?? 0) + 1 });
      continue;
    }
    knownCosts += 1;
    costBasis += cost;
    costedMarketValue += marketValueForHolding;
  }

  const coverage: FamilyPnlCoverage = knownCosts === 0
    ? 'unavailable'
    : knownCosts === matched.length
      ? 'complete'
      : 'partial';
  const pnl = knownCosts === 0 ? 0 : costedMarketValue - costBasis;
  const unknownCostHoldings = [...unknownCostCounts.values()].map(({ symbol, isOption, count }) => {
    if (isOption) return count > 1 ? `${symbol}（期权 ×${count}）` : `${symbol}（期权）`;
    return count > 1 ? `${symbol}（×${count}）` : symbol;
  });

  return {
    marketValue,
    costedMarketValue,
    uncostedMarketValue: marketValue - costedMarketValue,
    costBasis,
    pnl,
    pnlPct: knownCosts > 0 && costBasis > 0 ? (pnl / costBasis) * 100 : null,
    coverage,
    unknownCostHoldings,
  };
}
