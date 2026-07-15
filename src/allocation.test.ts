import { describe, expect, it } from 'vitest';
import { buildAllocationSlices } from './allocation';
import { computeMetrics } from './metrics';
import type { ExchangeRates, Holding, PortfolioState } from './types';

const rates: ExchangeRates = { USD: 1, CNY: 7, HKD: 7.8, JPY: 155, EUR: 0.92, GBP: 0.79, updatedAt: null, source: 'fallback' };

function row(id: string, symbol: string, value: number): Holding {
  return {
    id, symbol, name: symbol, shares: value, buyPrice: 1, currentPrice: 1,
    sector: '科技', currency: 'USD', assetType: symbol === 'SGOV' ? 'etf' : 'stock',
  };
}

describe('buildAllocationSlices', () => {
  it('groups duplicate symbols, separates liquidity, limits slices, and hides tiny labels', () => {
    const holdings: Holding[] = [
      ...Array.from({ length: 5 }, (_, index) => row(`nvda-${index}`, 'NVDA', 1)),
      row('sgov', 'SGOV', 10),
      ...Array.from({ length: 19 }, (_, index) => row(`stock-${index}`, `S${index}`, 1)),
    ];
    const state: PortfolioState = {
      holdings,
      cash: [{ amount: 5, currency: 'USD' }],
      updatedAt: '2026-07-14T00:00:00.000Z',
    };

    const slices = buildAllocationSlices(computeMetrics(state, rates));

    expect(slices.length).toBeLessThanOrEqual(14);
    expect(slices.filter((slice) => slice.name === 'NVDA')).toHaveLength(1);
    expect(slices.find((slice) => slice.name === 'NVDA')?.value).toBe(5);
    expect(slices.find((slice) => slice.name === '现金类 ETF(SGOV等)')?.value).toBe(10);
    expect(slices.some((slice) => slice.name.startsWith('其他（'))).toBe(true);
    expect(slices.some((slice) => slice.weight < 0.03 && slice.showLabel)).toBe(false);
  });

  it('uses balanced full-width parentheses for the grouped remainder label', () => {
    const state: PortfolioState = {
      holdings: Array.from({ length: 5 }, (_, index) => row(`stock-${index}`, `S${index}`, 5 - index)),
      cash: [],
      updatedAt: '2026-07-15T00:00:00.000Z',
    };

    const slices = buildAllocationSlices(computeMetrics(state, rates), { maxSlices: 3 });

    expect(slices.map((slice) => slice.name)).toContain('其他（3 项）');
  });
});
