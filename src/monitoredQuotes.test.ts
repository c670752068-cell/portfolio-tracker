import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MONITORED_QUOTES_CACHE_KEY,
  fetchMonitoredQuotes,
  monitoredQuoteSymbols,
} from './monitoredQuotes';
import type { Holding, QuantAnalysisSnapshot } from './types';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

function snapshot(symbols: string[]): QuantAnalysisSnapshot {
  return {
    source: 'futu-assistant',
    generated_at: '2026-07-22T12:00:00Z',
    rule_version: 'test',
    disclaimer: 'test',
    context: {},
    symbols: Object.fromEntries(symbols.map((symbol) => [symbol, { available: true }])),
  };
}

function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    id: 'holding',
    symbol: 'NVDA',
    name: 'NVIDIA',
    shares: 1,
    buyPrice: 100,
    currentPrice: 110,
    sector: '科技',
    currency: 'USD',
    assetType: 'stock',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('monitoredQuoteSymbols', () => {
  it('excludes held quotes, cash equivalents, and symbols with quant prices', () => {
    const value = snapshot(['NVDA', 'AVGO', 'MU', 'SGOV']);
    value.symbols.MU!.depth_window = {
      applicable: true,
      open: false,
      current_pct: -10,
      threshold_pct: -20,
      current_price: 120,
      high_price: 150,
      threshold_price: 120,
      next_level_price: null,
      price_session: 'regular',
      win_rate_60d: null,
      n: 0,
      sample_insufficient: true,
      bear_included: false,
    };

    expect(monitoredQuoteSymbols(value, [
      holding({ quote: {
        symbol: 'NVDA',
        price: 110,
        previousClose: 109,
        change: 1,
        changePercent: 0.01,
        currency: 'USD',
        timestamp: '2026-07-22T12:00:00Z',
        source: 'proxy',
        isRealtime: true,
      } }),
    ])).toEqual(['AVGO']);
  });
});

describe('fetchMonitoredQuotes', () => {
  it('passes through session and price time for monitored symbols', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      quotes: [{
        symbol: 'AVGO',
        price: 384.98,
        session: 'pre',
        priceTime: '2026-07-23T13:20:00Z',
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const result = await fetchMonitoredQuotes({
      snapshot: snapshot(['AVGO']),
      holdings: [],
      quoteProxyUrl: 'https://quotes.example.test/api/quotes',
      now: new Date('2026-07-23T13:20:00Z'),
      storage,
    });

    expect(result.get('AVGO')).toEqual(expect.objectContaining({
      price: 384.98,
      session: 'pre',
      priceTime: '2026-07-23T13:20:00Z',
    }));
  });

  it('requests 60 symbols in batches of 50 and 10', async () => {
    const storage = memoryStorage();
    const symbols = Array.from({ length: 60 }, (_, index) => `S${index + 1}`);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const requested = new URL(String(input)).searchParams.get('symbols')!.split(',');
      return new Response(JSON.stringify({
        quotes: requested.map((symbol, index) => ({ symbol, price: 100 + index })),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMonitoredQuotes({
      snapshot: snapshot(symbols),
      holdings: [],
      quoteProxyUrl: 'https://quotes.example.test/api/quotes',
      now: new Date('2026-07-22T12:00:00Z'),
      storage,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get('symbols')!.split(',')).toHaveLength(50);
    expect(new URL(String(fetchMock.mock.calls[1]![0])).searchParams.get('symbols')!.split(',')).toHaveLength(10);
    expect(result).toHaveLength(60);
  });

  it('reuses a 24-minute cache without requesting and refreshes after 26 minutes', async () => {
    const storage = memoryStorage();
    storage.setItem(MONITORED_QUOTES_CACHE_KEY, JSON.stringify({
      fetchedAt: '2026-07-22T12:00:00.000Z',
      prices: { AVGO: 396.81 },
    }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      quotes: [{ symbol: 'AVGO', price: 400 }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const cached = await fetchMonitoredQuotes({
      snapshot: snapshot(['AVGO']),
      holdings: [],
      quoteProxyUrl: 'https://quotes.example.test/api/quotes',
      now: new Date('2026-07-22T12:24:00Z'),
      storage,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cached.get('AVGO')).toBe(396.81);

    const refreshed = await fetchMonitoredQuotes({
      snapshot: snapshot(['AVGO']),
      holdings: [],
      quoteProxyUrl: 'https://quotes.example.test/api/quotes',
      now: new Date('2026-07-22T12:26:00Z'),
      storage,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshed.get('AVGO')).toEqual(expect.objectContaining({ price: 400 }));
  });

  it('keeps the old cache when refresh fails and does not throw', async () => {
    const storage = memoryStorage();
    storage.setItem(MONITORED_QUOTES_CACHE_KEY, JSON.stringify({
      fetchedAt: '2026-07-22T11:00:00.000Z',
      prices: { AVGO: 390 },
    }));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(fetchMonitoredQuotes({
      snapshot: snapshot(['AVGO']),
      holdings: [],
      quoteProxyUrl: 'https://quotes.example.test/api/quotes',
      now: new Date('2026-07-22T12:00:00Z'),
      storage,
    })).resolves.toEqual(new Map([['AVGO', 390]]));
  });

  it('skips quietly when no quote proxy is configured', async () => {
    const storage = memoryStorage();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMonitoredQuotes({
      snapshot: snapshot(['AVGO']),
      holdings: [],
      quoteProxyUrl: '',
      now: new Date('2026-07-22T12:00:00Z'),
      storage,
    })).resolves.toEqual(new Map());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
