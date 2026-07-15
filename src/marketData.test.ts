import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncHoldingsWithQuotes } from './marketData';
import { computeMetrics } from './metrics';
import type { AppSettings, ExchangeRates, Holding } from './types';

const settings: AppSettings = {
  aiProvider: 'zhipu', kimiApiKey: '', kimiModel: 'kimi-k2.6', proxyUrl: '',
  zhipuApiKey: '', zhipuModel: 'glm-4.6v-flash', zhipuProxyUrl: '',
  quoteProvider: 'proxy', quoteApiKey: '', quoteProxyUrl: 'https://quotes.example.test/api/quotes',
  autoRefreshQuotes: true,
  displayCurrency: 'USD',
  exposureTargetPct: 100,
};

const usdRates: ExchangeRates = {
  USD: 1, CNY: 7, HKD: 7.8, JPY: 155, EUR: 0.92, GBP: 0.79,
  updatedAt: null, source: 'fallback',
};

function holding(overrides: Partial<Holding>): Holding {
  return {
    id: 'holding', symbol: 'AAPL', name: 'Apple', shares: 1, buyPrice: 100,
    currentPrice: 110, sector: '科技', currency: 'USD', assetType: 'stock',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('syncHoldingsWithQuotes symbol hygiene', () => {
  it('requests only valid tickers and reports an option without underlying as skipped', async () => {
    vi.stubGlobal('window', { location: { protocol: 'https:' } });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      quotes: [{ symbol: 'AAPL', price: 120, previousClose: 118, change: 2, changePercent: 0.0169, currency: 'USD' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await syncHoldingsWithQuotes([
      holding({ id: 'aapl' }),
      holding({ id: 'bad-option', symbol: 'MSFU CALL', assetType: 'option', option: undefined }),
    ], settings);

    expect(result.requestedSymbols).toEqual(['AAPL']);
    expect(result.skippedSymbols).toEqual(['MSFU CALL']);
    expect(result.failedSymbols).toEqual([]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('symbols=AAPL');
  });
});

describe('option quote refresh integration', () => {
  it('counts Delta-estimated options, updates underlying price, and changes equivalent exposure', async () => {
    vi.stubGlobal('window', { location: { protocol: 'https:' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      quotes: [{ symbol: 'IGV', price: 110, previousClose: 108, change: 2, changePercent: 0.0185, currency: 'USD' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const option = holding({
      id: 'igv-call', symbol: 'IGV', name: 'IGV CALL', assetType: 'option',
      shares: 1, currentPrice: 10,
      option: {
        underlying: 'IGV', optionType: 'call', strike: 80, expiration: '2027-01-15',
        contractMultiplier: 100, delta: 0.5, theta: null, gamma: null, vega: null,
        impliedVolatility: null, underlyingPrice: 100,
      },
    });
    const before = computeMetrics({ holdings: [option], cash: [], updatedAt: 'old' }, usdRates);

    const result = await syncHoldingsWithQuotes([option], settings);
    const after = computeMetrics({ holdings: result.holdings, cash: [], updatedAt: result.updatedAt }, usdRates);

    expect(result.deltaEstimatedCount).toBe(1);
    expect(result.holdings[0]?.option?.underlyingPrice).toBe(110);
    expect(result.holdings[0]?.currentPrice).toBe(15);
    expect(result.holdings[0]?.quote?.source).toBe('delta_estimate');
    expect(before.equivalentExposureTotal).toBe(5000);
    expect(after.equivalentExposureTotal).toBe(5500);
  });

  it('does not count an option whose quote only updates the underlying because Delta is missing', async () => {
    vi.stubGlobal('window', { location: { protocol: 'https:' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      quotes: [{ symbol: 'IGV', price: 110, currency: 'USD' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const option = holding({
      symbol: 'IGV', assetType: 'option',
      option: {
        underlying: 'IGV', optionType: 'call', strike: 80, expiration: '2027-01-15',
        contractMultiplier: 100, delta: null, theta: null, gamma: null, vega: null,
        impliedVolatility: null, underlyingPrice: 100,
      },
    });

    const result = await syncHoldingsWithQuotes([option], settings);

    expect(result.deltaEstimatedCount).toBe(0);
    expect(result.holdings[0]?.option?.underlyingPrice).toBe(110);
    expect(result.holdings[0]?.quote?.source).toBe('proxy');
  });
});
