import type { AppSettings, Currency, Holding, QuoteProvider, QuoteSnapshot } from './types';

export interface QuoteSyncResult {
  holdings: Holding[];
  requestedSymbols: string[];
  updatedSymbols: string[];
  failedSymbols: Array<{ symbol: string; reason: string }>;
  skippedSymbols: string[];
  updatedAt: string;
}

type RawQuoteMap = Map<string, QuoteSnapshot>;

const US_MARKET_ASSET_TYPES = new Set(['stock', 'etf', 'leveraged_etf', 'option']);

export function canSyncQuotes(settings: AppSettings): boolean {
  if (settings.quoteProvider === 'none') return false;
  if (settings.quoteProvider === 'proxy') return Boolean(settings.quoteProxyUrl.trim());
  return Boolean(settings.quoteApiKey.trim());
}

export function quoteSyncSetupHint(settings: AppSettings): string {
  if (settings.quoteProvider === 'none') return '未开启行情源。可在设置里选择 Finnhub、FMP、Alpha Vantage 或自建代理。';
  if (settings.quoteProvider === 'proxy' && !settings.quoteProxyUrl.trim()) return '请填写行情代理 URL。';
  if (settings.quoteProvider !== 'proxy' && !settings.quoteApiKey.trim()) return '请填写行情 API Key。';
  return '';
}

export async function syncHoldingsWithQuotes(
  holdings: Holding[],
  settings: AppSettings,
): Promise<QuoteSyncResult> {
  const symbols = getSymbolsForQuotes(holdings);
  if (symbols.length === 0) {
    return {
      holdings,
      requestedSymbols: [],
      updatedSymbols: [],
      failedSymbols: [],
      skippedSymbols: [],
      updatedAt: new Date().toISOString(),
    };
  }
  if (!canSyncQuotes(settings)) throw new Error(quoteSyncSetupHint(settings));

  const { quotes, failedSymbols } = await fetchQuotes(settings, symbols);
  const updatedSymbols = new Set<string>();
  const skippedSymbols = new Set<string>();

  const nextHoldings = holdings.map((holding) => {
    if (!shouldSyncHolding(holding)) {
      if (holding.symbol) skippedSymbols.add(holding.symbol.toUpperCase());
      return holding;
    }

    if (holding.assetType === 'option') {
      const underlyingSymbol = normalizeSymbol(holding.option?.underlying || holding.symbol);
      const quote = quotes.get(underlyingSymbol);
      if (!quote) return holding;
      const updated = applyUnderlyingQuoteToOption(holding, quote);
      updatedSymbols.add(underlyingSymbol);
      return updated;
    }

    const symbol = normalizeSymbol(holding.symbol);
    const quote = quotes.get(symbol);
    if (!quote) return holding;
    updatedSymbols.add(symbol);
    return {
      ...holding,
      currentPrice: roundPrice(quote.price),
      marketValueOverride: undefined,
      quote,
    };
  });

  return {
    holdings: nextHoldings,
    requestedSymbols: symbols,
    updatedSymbols: [...updatedSymbols],
    failedSymbols,
    skippedSymbols: [...skippedSymbols],
    updatedAt: new Date().toISOString(),
  };
}

function getSymbolsForQuotes(holdings: Holding[]): string[] {
  const symbols = new Set<string>();
  for (const holding of holdings) {
    if (!shouldSyncHolding(holding)) continue;
    const symbol =
      holding.assetType === 'option'
        ? normalizeSymbol(holding.option?.underlying || holding.symbol)
        : normalizeSymbol(holding.symbol);
    if (symbol) symbols.add(symbol);
  }
  return [...symbols];
}

function shouldSyncHolding(holding: Holding): boolean {
  if (holding.currency !== 'USD') return false;
  if (!US_MARKET_ASSET_TYPES.has(holding.assetType ?? 'stock')) return false;
  return Boolean(normalizeSymbol(holding.assetType === 'option' ? holding.option?.underlying || holding.symbol : holding.symbol));
}

async function fetchQuotes(
  settings: AppSettings,
  symbols: string[],
): Promise<{ quotes: RawQuoteMap; failedSymbols: Array<{ symbol: string; reason: string }> }> {
  switch (settings.quoteProvider) {
    case 'finnhub':
      return fetchFinnhubQuotes(settings.quoteApiKey.trim(), symbols);
    case 'fmp':
      return fetchFmpQuotes(settings.quoteApiKey.trim(), symbols);
    case 'alphavantage':
      return fetchAlphaVantageQuotes(settings.quoteApiKey.trim(), symbols);
    case 'proxy':
      return fetchProxyQuotes(settings.quoteProxyUrl.trim(), symbols);
    default:
      throw new Error('未开启行情源。');
  }
}

async function fetchFinnhubQuotes(
  token: string,
  symbols: string[],
): Promise<{ quotes: RawQuoteMap; failedSymbols: Array<{ symbol: string; reason: string }> }> {
  const entries = await Promise.all(symbols.map(async (symbol) => {
    try {
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`;
      const data = await fetchJson<Record<string, unknown>>(url);
      if (typeof data.error === 'string') throw new Error(data.error);
      const price = asNumber(data.c);
      if (!price) throw new Error('未返回有效价格');
      const previousClose = asNullableNumber(data.pc);
      const change = asNullableNumber(data.d);
      return {
        symbol,
        quote: {
          symbol,
          price,
          previousClose,
          change,
          changePercent: asNullablePercent(data.dp, true),
          currency: 'USD' as Currency,
          timestamp: asUnixTimestamp(data.t),
          source: 'finnhub' as QuoteProvider,
          isRealtime: true,
        },
      };
    } catch (error) {
      return { symbol, error: errorMessage(error) };
    }
  }));
  return toQuoteResult(entries);
}

async function fetchFmpQuotes(
  apiKey: string,
  symbols: string[],
): Promise<{ quotes: RawQuoteMap; failedSymbols: Array<{ symbol: string; reason: string }> }> {
  const url = `https://financialmodelingprep.com/api/v3/quote/${symbols.map(encodeURIComponent).join(',')}?apikey=${encodeURIComponent(apiKey)}`;
  const data = await fetchJson<unknown>(url);
  if (isRecord(data) && typeof data['Error Message'] === 'string') throw new Error(data['Error Message']);
  const rows = Array.isArray(data) ? data : [];
  const quotes = new Map<string, QuoteSnapshot>();
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const symbol = normalizeSymbol(asText(row.symbol));
    const price = asNumber(row.price);
    if (!symbol || !price) continue;
    quotes.set(symbol, {
      symbol,
      price,
      previousClose: asNullableNumber(row.previousClose),
      change: asNullableNumber(row.change),
      changePercent: asNullablePercent(row.changesPercentage, true),
      currency: 'USD',
      timestamp: asUnixTimestamp(row.timestamp),
      source: 'fmp',
      isRealtime: true,
    });
  }
  return {
    quotes,
    failedSymbols: symbols.filter((symbol) => !quotes.has(symbol)).map((symbol) => ({ symbol, reason: '未返回报价' })),
  };
}

async function fetchAlphaVantageQuotes(
  apiKey: string,
  symbols: string[],
): Promise<{ quotes: RawQuoteMap; failedSymbols: Array<{ symbol: string; reason: string }> }> {
  const entries = await Promise.all(symbols.map(async (symbol) => {
    try {
      const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
      const data = await fetchJson<Record<string, unknown>>(url);
      if (typeof data.Information === 'string') throw new Error(data.Information);
      if (typeof data['Error Message'] === 'string') throw new Error(data['Error Message']);
      const quote = isRecord(data['Global Quote']) ? data['Global Quote'] : {};
      const price = asNumber(quote['05. price']);
      if (!price) throw new Error('未返回有效价格');
      return {
        symbol,
        quote: {
          symbol,
          price,
          previousClose: asNullableNumber(quote['08. previous close']),
          change: asNullableNumber(quote['09. change']),
          changePercent: asNullablePercent(quote['10. change percent'], true),
          currency: 'USD' as Currency,
          timestamp: asText(quote['07. latest trading day']) || null,
          source: 'alphavantage' as QuoteProvider,
          isRealtime: false,
        },
      };
    } catch (error) {
      return { symbol, error: errorMessage(error) };
    }
  }));
  return toQuoteResult(entries);
}

async function fetchProxyQuotes(
  baseUrl: string,
  symbols: string[],
): Promise<{ quotes: RawQuoteMap; failedSymbols: Array<{ symbol: string; reason: string }> }> {
  const url = new URL(baseUrl);
  url.searchParams.set('symbols', symbols.join(','));
  const data = await fetchJson<unknown>(url.toString());
  const rows = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.quotes) ? data.quotes : [];
  const quotes = new Map<string, QuoteSnapshot>();
  const failedSymbols: Array<{ symbol: string; reason: string }> = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const symbol = normalizeSymbol(asText(row.symbol));
    const price = asNumber(row.price);
    if (!symbol || !price) continue;
    quotes.set(symbol, {
      symbol,
      price,
      previousClose: asNullableNumber(row.previousClose),
      change: asNullableNumber(row.change),
      changePercent: asNullablePercent(row.changePercent, false),
      currency: asCurrency(row.currency),
      timestamp: asText(row.timestamp) || null,
      source: 'proxy',
      isRealtime: Boolean(row.isRealtime),
    });
  }
  if (isRecord(data) && Array.isArray(data.failedSymbols)) {
    for (const item of data.failedSymbols) {
      if (isRecord(item)) failedSymbols.push({ symbol: normalizeSymbol(asText(item.symbol)), reason: asText(item.reason) || '代理未返回报价' });
    }
  }
  return {
    quotes,
    failedSymbols: [
      ...failedSymbols,
      ...symbols.filter((symbol) => !quotes.has(symbol) && !failedSymbols.some((item) => item.symbol === symbol)).map((symbol) => ({ symbol, reason: '未返回报价' })),
    ],
  };
}

function applyUnderlyingQuoteToOption(holding: Holding, underlyingQuote: QuoteSnapshot): Holding {
  const option = holding.option;
  if (!option) return holding;
  const priorUnderlyingPrice = option.underlyingPrice;
  const delta = option.delta;
  const nextOption = { ...option, underlyingPrice: roundPrice(underlyingQuote.price) };
  if (priorUnderlyingPrice == null || delta == null || holding.currentPrice <= 0) {
    return {
      ...holding,
      option: nextOption,
      quote: {
        ...underlyingQuote,
        symbol: holding.symbol,
        note: `已同步标的 ${underlyingQuote.symbol}，但缺少 Delta 或旧标的价，未估算期权权利金。`,
      },
    };
  }

  const premiumChange = delta * (underlyingQuote.price - priorUnderlyingPrice);
  const nextPremium = Math.max(0, holding.currentPrice + premiumChange);
  const previousPremium = Math.max(0, nextPremium - premiumChange);
  return {
    ...holding,
    currentPrice: roundPrice(nextPremium),
    marketValueOverride: undefined,
    option: nextOption,
    quote: {
      symbol: holding.symbol,
      price: roundPrice(nextPremium),
      previousClose: previousPremium || null,
      change: premiumChange,
      changePercent: previousPremium > 0 ? premiumChange / previousPremium : null,
      currency: 'USD',
      timestamp: underlyingQuote.timestamp,
      source: 'delta_estimate',
      isRealtime: underlyingQuote.isRealtime,
      note: `用 ${underlyingQuote.symbol} 最新价按 Delta 粗估期权权利金；未包含 Gamma、Vega、Theta 和真实盘口。`,
    },
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(`响应非 JSON（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    if (isRecord(data)) {
      const message = asText(data.error) || asText(data.message) || asText(data['Error Message']);
      if (message) throw new Error(message);
    }
    throw new Error(`HTTP ${response.status}`);
  }
  return data as T;
}

function toQuoteResult(
  entries: Array<{ symbol: string; quote?: QuoteSnapshot; error?: string }>,
): { quotes: RawQuoteMap; failedSymbols: Array<{ symbol: string; reason: string }> } {
  const quotes = new Map<string, QuoteSnapshot>();
  const failedSymbols: Array<{ symbol: string; reason: string }> = [];
  for (const entry of entries) {
    if (entry.quote) quotes.set(entry.symbol, entry.quote);
    else failedSymbols.push({ symbol: entry.symbol, reason: entry.error || '未返回报价' });
  }
  return { quotes, failedSymbols };
}

function normalizeSymbol(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,%\s,]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asNullableNumber(value: unknown): number | null {
  const parsed = asNumber(value);
  return parsed === 0 && value !== 0 && value !== '0' && value !== '0.00' ? null : parsed;
}

function asNullablePercent(value: unknown, inputIsPercentPoints: boolean): number | null {
  const parsed = asNullableNumber(value);
  if (parsed === null) return null;
  return inputIsPercentPoints ? parsed / 100 : parsed;
}

function asUnixTimestamp(value: unknown): string | null {
  const seconds = asNullableNumber(value);
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString();
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asCurrency(value: unknown): Currency {
  const raw = asText(value).toUpperCase();
  return raw === 'USD' || raw === 'CNY' || raw === 'HKD' || raw === 'OTHER' ? raw : 'USD';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function roundPrice(value: number): number {
  return Math.round(value * 10000) / 10000;
}
