import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PE_CACHE_KEY,
  PeRateLimitError,
  fetchForwardPe,
  fetchQuantPeHistory,
  resolvePeSnapshot,
  type PeHistoryPayload,
} from './peData';

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

function history(): PeHistoryPayload {
  return {
    generated_at: '2026-07-22T12:00:00Z',
    metric: 'ttm_pe',
    frequency: 'weekly',
    percentile_definition: '0=历史最低，100=历史最高',
    lookback_years: 5,
    symbols: {
      MSFT: {
        current: 30,
        percentile: 55,
        series_start: '2021-07-22',
        series_end: '2026-07-22',
        series: [{ date: '2026-07-22', value: 30 }],
        source: 'Futu OpenD',
        frequency: 'weekly',
      },
    },
    missing_symbols: [],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchQuantPeHistory', () => {
  it('reads an embedded quant PE payload and preserves the explicit TTM metric', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      source: 'futu-assistant',
      pe_history: history(),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const result = await fetchQuantPeHistory('https://example.test/api/portfolio/quant-analysis');

    expect(result.metric).toBe('ttm_pe');
    expect(result.symbols.MSFT?.current).toBe(30);
  });
});

describe('fetchForwardPe', () => {
  it('parses Alpha Vantage numeric strings and converts None to null', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      Symbol: 'IBM',
      ForwardPE: '17.42',
      TrailingPE: 'None',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const result = await fetchForwardPe('IBM', 'demo', {
      now: new Date('2026-07-22T12:00:00Z'),
      storage,
    });

    expect(result.forwardPe).toBe(17.42);
    expect(result.trailingPe).toBeNull();
    expect(result.source).toBe('alphavantage');
  });

  it('throws a recognizable rate-limit error for Note or Information responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      Information: '25 requests per day',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(fetchForwardPe('IBM', 'demo', {
      now: new Date('2026-07-22T12:00:00Z'),
      storage: memoryStorage(),
    })).rejects.toBeInstanceOf(PeRateLimitError);
  });

  it('uses the daily cache for a second call on the same day', async () => {
    const storage = memoryStorage();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      Symbol: 'IBM',
      ForwardPE: '17.42',
      TrailingPE: '18.83',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const options = { now: new Date('2026-07-22T12:00:00Z'), storage };

    await fetchForwardPe('IBM', 'demo', options);
    const cached = await fetchForwardPe('IBM', 'demo', options);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cached.forwardPe).toBe(17.42);
    expect(storage.getItem(PE_CACHE_KEY)).toContain('"IBM"');
  });
});

describe('resolvePeSnapshot', () => {
  it('uses quant history without calling Alpha Vantage', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolvePeSnapshot('MSFT', history(), 'demo', {
      now: new Date('2026-07-22T12:00:00Z'),
      storage: memoryStorage(),
    });

    expect(result).toEqual({
      symbol: 'MSFT',
      forwardPe: null,
      trailingPe: 30,
      source: 'quant',
      fetchedAt: '2026-07-22T12:00:00Z',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
