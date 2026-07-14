import type { Holding, ImportedPortfolio, ImportIssue, PortfolioState } from './types';

type ImportedHolding = Omit<Holding, 'id'>;

export function mergeImportedHoldings(holdings: ImportedHolding[]): ImportedHolding[] {
  const merged = new Map<string, ImportedHolding>();
  for (const holding of holdings) {
    const key = mergeKey(holding);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...holding, missingFields: [...(holding.missingFields ?? [])] });
      continue;
    }
    const currentMarketValue = nativeMarketValue(current);
    const nextMarketValue = nativeMarketValue(holding);
    const shares = current.shares + holding.shares;
    const buyPrice = weightedPositivePrice(current, holding, shares);
    merged.set(key, {
      ...current,
      shares,
      buyPrice,
      currentPrice: nextMarketValue > currentMarketValue ? holding.currentPrice : current.currentPrice,
      marketValueOverride: sumOnlyWhenBothKnown(current.marketValueOverride, holding.marketValueOverride),
      costOverride: sumOnlyWhenBothKnown(current.costOverride, holding.costOverride),
      confidence: lowerConfidence(current.confidence, holding.confidence),
      missingFields: [...new Set([...(current.missingFields ?? []), ...(holding.missingFields ?? [])])],
    });
  }
  return [...merged.values()];
}

function mergeKey(holding: ImportedHolding): string {
  const base = `${holding.symbol}|${holding.assetType ?? 'stock'}|${holding.currency}`;
  if (holding.assetType !== 'option') return base;
  const option = holding.option;
  return `${base}|${option?.underlying ?? ''}|${option?.optionType ?? ''}|${option?.strike ?? ''}|${option?.expiration ?? ''}`;
}

function nativeMarketValue(holding: ImportedHolding): number {
  const multiplier = holding.assetType === 'option' ? holding.option?.contractMultiplier ?? 100 : 1;
  return holding.marketValueOverride ?? holding.shares * holding.currentPrice * multiplier;
}

function weightedPositivePrice(left: ImportedHolding, right: ImportedHolding, totalShares: number): number {
  if (left.buyPrice > 0 && right.buyPrice > 0 && totalShares > 0) {
    return (left.buyPrice * left.shares + right.buyPrice * right.shares) / totalShares;
  }
  return left.buyPrice > 0 ? left.buyPrice : right.buyPrice > 0 ? right.buyPrice : 0;
}

function sumOnlyWhenBothKnown(left: number | undefined, right: number | undefined): number | undefined {
  return left != null && right != null ? left + right : undefined;
}

function lowerConfidence(
  left: Holding['confidence'],
  right: Holding['confidence'],
): Holding['confidence'] {
  const rank = { high: 2, medium: 1, low: 0 } as const;
  const leftValue = left ?? 'medium';
  const rightValue = right ?? 'medium';
  return rank[leftValue] <= rank[rightValue] ? leftValue : rightValue;
}

export function crossCheckImportedPnl(
  holding: ImportedHolding,
  issues: ImportIssue[],
): ImportedHolding {
  const costKnown = holding.costOverride != null || (holding.shares > 0 && holding.buyPrice > 0);
  if (!costKnown || holding.reportedPnl == null) return holding;
  const marketValue = nativeMarketValue(holding);
  const multiplier = holding.assetType === 'option' ? holding.option?.contractMultiplier ?? 100 : 1;
  const cost = holding.costOverride ?? holding.shares * holding.buyPrice * multiplier;
  const computedPnl = marketValue - cost;
  const signsDiffer = (computedPnl < 0 && holding.reportedPnl > 0)
    || (computedPnl > 0 && holding.reportedPnl < 0);
  const differenceTooLarge = Math.abs(computedPnl - holding.reportedPnl)
    > Math.max(Math.abs(marketValue) * 0.1, 50);
  if (!signsDiffer && !differenceTooLarge) return holding;
  const missingFields = [...new Set([...(holding.missingFields ?? []), '成本待核对'])];
  issues.push({
    field: `${holding.symbol} 成本待核对`,
    reason: `${holding.symbol} 识别出的盈亏（${computedPnl.toFixed(2)}）与券商截图显示（${holding.reportedPnl.toFixed(2)}）不符，买入价或股数可能读错，请到持仓表核对。`,
    priority: 'required',
  });
  return { ...holding, confidence: 'low', missingFields };
}

export function applyImageImport(
  current: PortfolioState,
  result: ImportedPortfolio,
  createId: () => string,
): PortfolioState {
  return {
    holdings: [
      ...current.holdings.filter((holding) => holding.source !== 'image-import'),
      ...result.holdings.map((holding) => ({ ...holding, id: createId() })),
    ],
    cash: [
      ...current.cash.filter((cash) => cash.source !== 'image-import'),
      ...result.cash,
    ],
    updatedAt: new Date().toISOString(),
  };
}
