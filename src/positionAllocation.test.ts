import { describe, expect, it } from 'vitest';
import type { ExchangeRates, Holding } from './types';
import { stockFamilyAllocation } from './positionAllocation';

const rates: ExchangeRates = {
  USD: 1, CNY: 7, HKD: 7.8, JPY: 150, EUR: 0.9, GBP: 0.8,
  updatedAt: null, source: 'fallback',
};

const holdings: Holding[] = [
  { id: 'meta', symbol: 'META', name: 'Meta', shares: 10, buyPrice: 400, currentPrice: 500, sector: '科技', currency: 'USD', assetType: 'stock' },
  { id: 'metu', symbol: 'METU', name: 'Meta 2x', shares: 100, buyPrice: 25, currentPrice: 30, sector: '科技', currency: 'USD', assetType: 'leveraged_etf' },
  { id: 'nvda', symbol: 'NVDA', name: 'Nvidia', shares: 10, buyPrice: 100, currentPrice: 100, sector: '科技', currency: 'USD', assetType: 'stock' },
];

describe('stockFamilyAllocation', () => {
  it('combines the stock and its 2x ETF by actual invested value', () => {
    expect(stockFamilyAllocation('META', holdings, 100_000, rates)).toEqual({
      family: 'META',
      currentPct: 8,
      capPct: 10,
      marketValueUsd: 8_000,
      members: ['META', 'METU'],
    });
  });

  it('does not treat a plain ETF as a capped single-stock family', () => {
    expect(stockFamilyAllocation('QQQ', holdings, 100_000, rates)).toBeNull();
  });
});
