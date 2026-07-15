import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncHoldingsWithQuotes } from './marketData';
import type { AppSettings, Holding } from './types';

const settings: AppSettings = {
  aiProvider: 'zhipu', kimiApiKey: '', kimiModel: 'kimi-k2.6', proxyUrl: '',
  zhipuApiKey: '', zhipuModel: 'glm-4.6v-flash', zhipuProxyUrl: '',
  quoteProvider: 'proxy', quoteApiKey: '', quoteProxyUrl: 'https://quotes.example.test/api/quotes',
  autoRefreshQuotes: true,
  displayCurrency: 'USD',
  exposureTargetPct: 100,
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
