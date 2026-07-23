import type { Holding } from './types';

export function depthQuotePrice(
  holdings: readonly Holding[],
  monitoredQuotes: ReadonlyMap<string, number>,
  rawSymbol: string,
): number | null {
  const symbol = rawSymbol.trim().toUpperCase();
  for (const holding of holdings) {
    if (!holding.quote) continue;
    if (holding.assetType === 'option') {
      if (
        holding.option?.underlying.trim().toUpperCase() === symbol
        && typeof holding.option.underlyingPrice === 'number'
        && Number.isFinite(holding.option.underlyingPrice)
        && holding.option.underlyingPrice > 0
      ) {
        return holding.option.underlyingPrice;
      }
      continue;
    }
    if (
      holding.symbol.trim().toUpperCase() === symbol
      && Number.isFinite(holding.quote.price)
      && holding.quote.price > 0
    ) {
      return holding.quote.price;
    }
  }
  const monitoredPrice = monitoredQuotes.get(symbol);
  if (
    typeof monitoredPrice === 'number'
    && Number.isFinite(monitoredPrice)
    && monitoredPrice > 0
  ) {
    return monitoredPrice;
  }
  return null;
}
