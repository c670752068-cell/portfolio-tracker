import { describe, expect, it } from 'vitest';
import { computeMetrics } from './metrics';
import type { ExchangeRates, PortfolioState } from './types';

const usdRates: ExchangeRates = {
  USD: 1,
  CNY: 7,
  HKD: 7.8,
  JPY: 155,
  EUR: 0.92,
  GBP: 0.79,
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

  it('calculates pnl percentage only over known holding cost and excludes cash', () => {
    const state: PortfolioState = {
      holdings: [
        {
          id: 'known', symbol: 'AAPL', name: 'Apple', assetType: 'stock',
          shares: 1, buyPrice: 100, currentPrice: 120, sector: '科技', currency: 'USD',
        },
        {
          id: 'unknown', symbol: 'NVDA', name: 'NVIDIA', assetType: 'stock',
          shares: 1, buyPrice: 0, currentPrice: 80, sector: '科技', currency: 'USD',
        },
      ],
      cash: [{ amount: 20, currency: 'USD' }],
      updatedAt: '2026-07-14T00:00:00.000Z',
    };

    const metrics = computeMetrics(state, usdRates);

    expect(metrics.knownCostSum).toBe(100);
    expect(metrics.totalPnl).toBe(20);
    expect(metrics.totalPnlPct).toBe(0.2);
    expect(metrics.unknownCostItems).toBe(1);
  });
});
