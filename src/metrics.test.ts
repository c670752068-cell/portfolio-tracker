import { describe, expect, it } from 'vitest';
import { computeMetrics } from './metrics';
import type { ExchangeRates, PortfolioState } from './types';

const usdRates: ExchangeRates = {
  USD: 1,
  CNY: 7,
  HKD: 7.8,
  updatedAt: '2026-07-14T00:00:00.000Z',
  source: 'fallback',
};

describe('computeMetrics liquidity', () => {
  it('counts SGOV as liquidity while keeping it inside equityValue', () => {
    const state: PortfolioState = {
      holdings: [
        {
          id: 'sgov', symbol: 'SGOV', name: '0-3 Month Treasury ETF', assetType: 'etf',
          shares: 40, buyPrice: 1, currentPrice: 1, sector: 'ETF / 指数', currency: 'USD',
        },
        {
          id: 'aapl', symbol: 'AAPL', name: 'Apple', assetType: 'stock',
          shares: 50, buyPrice: 1, currentPrice: 1, sector: '科技', currency: 'USD',
        },
      ],
      cash: [{ amount: 10, currency: 'USD' }],
      updatedAt: '2026-07-14T00:00:00.000Z',
    };

    const metrics = computeMetrics(state, usdRates);

    expect(metrics.equityValue).toBe(90);
    expect(metrics.cashValue).toBe(10);
    expect(metrics.cashEquivalentValue).toBe(40);
    expect(metrics.liquidityValue).toBe(50);
    expect(metrics.liquidityWeight).toBe(0.5);
  });
});
