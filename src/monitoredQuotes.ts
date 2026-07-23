import { CASH_EQUIVALENT_SYMBOLS } from './assetClass';
import { sanitizeEndpointUrl } from './endpointUrl';
import type { Holding, QuantAnalysisSnapshot } from './types';

export const MONITORED_QUOTES_CACHE_KEY = 'portfolio-tracker:monitored-quotes-v1';
export const MONITORED_QUOTES_TTL_MS = 25 * 60 * 1000;
export const MONITORED_QUOTES_BATCH_SIZE = 50;

interface MonitoredQuoteCache {
  fetchedAt: string;
  prices: Record<string, number>;
}

interface FetchMonitoredQuotesOptions {
  snapshot: QuantAnalysisSnapshot;
  holdings: readonly Holding[];
  quoteProxyUrl: string;
  now?: Date;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

export function monitoredQuoteSymbols(
  snapshot: QuantAnalysisSnapshot,
  holdings: readonly Holding[],
): string[] {
  const heldWithQuote = new Set(holdings
    .filter((holding) => holding.quote)
    .map((holding) => holding.assetType === 'option'
      ? holding.option?.underlying
      : holding.symbol)
    .map(normalizeSymbol)
    .filter(Boolean));

  return Object.keys(snapshot.symbols)
    .map(normalizeSymbol)
    .filter(Boolean)
    .filter((symbol) => !CASH_EQUIVALENT_SYMBOLS.has(symbol))
    .filter((symbol) => !heldWithQuote.has(symbol))
    .filter((symbol) => !hasQuantPrice(snapshot, symbol));
}

export async function fetchMonitoredQuotes(
  options: FetchMonitoredQuotesOptions,
): Promise<Map<string, number>> {
  const storage = options.storage ?? localStorage;
  const now = options.now ?? new Date();
  const cached = readCache(storage);
  if (cached && now.getTime() - Date.parse(cached.fetchedAt) < MONITORED_QUOTES_TTL_MS) {
    return pricesMap(cached.prices);
  }

  const endpoint = sanitizeEndpointUrl(options.quoteProxyUrl);
  if (!endpoint) return cached ? pricesMap(cached.prices) : new Map();

  const symbols = monitoredQuoteSymbols(options.snapshot, options.holdings);
  if (symbols.length === 0) return new Map();

  try {
    const batches = chunk(symbols, MONITORED_QUOTES_BATCH_SIZE);
    const responses = await Promise.all(batches.map(async (batch) => {
      const url = new URL(endpoint);
      url.searchParams.set('symbols', batch.join(','));
      const response = await fetch(url.toString());
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseQuoteResponse(await response.json());
    }));
    const prices = Object.assign({}, ...responses);
    const nextCache: MonitoredQuoteCache = {
      fetchedAt: now.toISOString(),
      prices,
    };
    try {
      storage.setItem(MONITORED_QUOTES_CACHE_KEY, JSON.stringify(nextCache));
    } catch {
      // A storage quota/private-mode failure must not hide otherwise valid quotes.
    }
    return pricesMap(prices);
  } catch {
    return cached ? pricesMap(cached.prices) : new Map();
  }
}

function hasQuantPrice(snapshot: QuantAnalysisSnapshot, symbol: string): boolean {
  const value = snapshot.symbols[symbol]?.depth_window?.current_price;
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function parseQuoteResponse(value: unknown): Record<string, number> {
  const rows = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.quotes)
      ? value.quotes
      : [];
  const prices: Record<string, number> = {};
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const symbol = normalizeSymbol(row.symbol);
    const price = typeof row.price === 'number' ? row.price : Number(row.price);
    if (symbol && Number.isFinite(price) && price > 0) prices[symbol] = price;
  }
  return prices;
}

function readCache(storage: Pick<Storage, 'getItem'>): MonitoredQuoteCache | null {
  try {
    const raw = storage.getItem(MONITORED_QUOTES_CACHE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.fetchedAt !== 'string' || !isRecord(value.prices)) {
      return null;
    }
    const prices = parsePrices(value.prices);
    return Number.isFinite(Date.parse(value.fetchedAt))
      ? { fetchedAt: value.fetchedAt, prices }
      : null;
  } catch {
    return null;
  }
}

function parsePrices(value: Record<string, unknown>): Record<string, number> {
  const prices: Record<string, number> = {};
  for (const [rawSymbol, rawPrice] of Object.entries(value)) {
    const symbol = normalizeSymbol(rawSymbol);
    const price = typeof rawPrice === 'number' ? rawPrice : Number(rawPrice);
    if (symbol && Number.isFinite(price) && price > 0) prices[symbol] = price;
  }
  return prices;
}

function pricesMap(prices: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(prices));
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function normalizeSymbol(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
