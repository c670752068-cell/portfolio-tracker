import type { Holding, QuoteSnapshot } from './types';

export type DepthQuote = number | QuoteSnapshot;

export function depthQuoteSnapshot(
  holdings: readonly Holding[],
  monitoredQuotes: ReadonlyMap<string, DepthQuote>,
  rawSymbol: string,
): QuoteSnapshot | null {
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
        return {
          ...holding.quote,
          symbol,
          price: holding.option.underlyingPrice,
        };
      }
      continue;
    }
    if (
      holding.symbol.trim().toUpperCase() === symbol
      && Number.isFinite(holding.quote.price)
      && holding.quote.price > 0
    ) {
      return holding.quote;
    }
  }
  const monitored = monitoredQuotes.get(symbol);
  if (typeof monitored === 'number') {
    if (!Number.isFinite(monitored) || monitored <= 0) return null;
    return {
      symbol,
      price: monitored,
      previousClose: null,
      change: null,
      changePercent: null,
      currency: 'USD',
      timestamp: null,
      source: 'proxy',
    };
  }
  return monitored && Number.isFinite(monitored.price) && monitored.price > 0
    ? monitored
    : null;
}

export function depthQuotePrice(
  holdings: readonly Holding[],
  monitoredQuotes: ReadonlyMap<string, DepthQuote>,
  rawSymbol: string,
): number | null {
  return depthQuoteSnapshot(holdings, monitoredQuotes, rawSymbol)?.price ?? null;
}
