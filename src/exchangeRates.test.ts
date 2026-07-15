import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLatestExchangeRates, loadExchangeRates } from './exchangeRates';

const CACHE_KEY = 'portfolio-tracker:usd-rates-v1';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } satisfies Storage;
}

describe('exchange rates for display currencies', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests and parses all five non-USD display currencies', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      date: '2026-07-15',
      rates: { CNY: 6.7776, HKD: 7.8386, JPY: 155, EUR: 0.92, GBP: 0.79 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const rates = await fetchLatestExchangeRates();

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('symbols=CNY,HKD,JPY,EUR,GBP'));
    expect(rates).toMatchObject({ CNY: 6.7776, HKD: 7.8386, JPY: 155, EUR: 0.92, GBP: 0.79 });
  });

  it('fills new currencies from fallback when an old cache only has CNY and HKD', () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ CNY: 6.8, HKD: 7.84, updatedAt: '2026-07-14' }));

    const rates = loadExchangeRates();

    expect(rates).toMatchObject({ CNY: 6.8, HKD: 7.84, JPY: 155, EUR: 0.92, GBP: 0.79, source: 'cache' });
  });
});
