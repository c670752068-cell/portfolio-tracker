import type { PriceSession, QuantAnalysisSnapshot, QuoteSnapshot } from './types';

/**
 * The quant snapshot already carries a price for every symbol it evaluated
 * (`depth_window.current_price`).  `monitoredQuoteSymbols` deliberately skips
 * those symbols when calling the quote proxy, so this is the only source for
 * them — without it the valuation card renders 「股价 暂无」.
 */
export function quantSnapshotQuote(
  snapshot: QuantAnalysisSnapshot | null,
  rawSymbol: string,
): QuoteSnapshot | null {
  const symbol = rawSymbol.trim().toUpperCase();
  const window = snapshot?.symbols[symbol]?.depth_window;
  const price = window?.current_price;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  return {
    symbol,
    price,
    previousClose: null,
    change: null,
    changePercent: null,
    currency: 'USD',
    timestamp: null,
    session: priceSession(window?.price_session),
    source: 'quant',
  };
}

function priceSession(value: unknown): PriceSession | undefined {
  return value === 'pre'
    || value === 'regular'
    || value === 'post'
    || value === 'overnight'
    || value === 'closed'
    ? value
    : undefined;
}
