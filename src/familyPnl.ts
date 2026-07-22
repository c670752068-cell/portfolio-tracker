import type { Holding, QuantHoldingCost } from './types';

export type FamilyPnlCoverage = 'complete' | 'partial' | 'unavailable';

export interface FamilyPnl {
  marketValue: number;
  costBasis: number;
  pnl: number;
  pnlPct: number | null;
  coverage: FamilyPnlCoverage;
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
  const external = holdingCosts[normalize(holding.symbol)]?.weighted_average_cost;
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

  for (const holding of matched) {
    const marketValueForHolding = marketValueFor(holding);
    marketValue += marketValueForHolding;
    const cost = costBasisFor(holding, holdingCosts);
    if (cost === null) continue;
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

  return {
    marketValue,
    costBasis,
    pnl,
    pnlPct: knownCosts > 0 && costBasis > 0 ? (pnl / costBasis) * 100 : null,
    coverage,
  };
}
