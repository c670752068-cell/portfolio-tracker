import { describe, expect, it } from 'vitest';
import type { Holding, QuantHoldingCost } from './types';
import { computeFamilyPnl } from './familyPnl';

function stock(overrides: Partial<Holding> = {}): Holding {
  return {
    id: 'msft', symbol: 'MSFT', name: '微软', shares: 10, buyPrice: 100,
    currentPrice: 80, sector: '科技', currency: 'USD', assetType: 'stock',
    ...overrides,
  };
}

describe('computeFamilyPnl', () => {
  it('computes a complete losing family from current market value and cost', () => {
    expect(computeFamilyPnl([stock()], 'MSFT', ['MSFT'], {})).toEqual({
      marketValue: 800,
      costBasis: 1000,
      pnl: -200,
      pnlPct: -20,
      coverage: 'complete',
    });
  });

  it('uses the contract multiplier for option market value and cost', () => {
    const option = stock({
      id: 'igv-call', symbol: 'IGV CALL', name: 'IGV Call', shares: 2,
      buyPrice: 2, currentPrice: 3, assetType: 'option',
      option: {
        underlying: 'IGV', optionType: 'call', strike: 80, expiration: '2027-01-15',
        contractMultiplier: 100, delta: 0.8, theta: null, gamma: null, vega: null,
        impliedVolatility: null, underlyingPrice: 95,
      },
    });

    expect(computeFamilyPnl([option], 'IGV', ['IGV'], {})).toEqual({
      marketValue: 600,
      costBasis: 400,
      pnl: 200,
      pnlPct: 50,
      coverage: 'complete',
    });
  });

  it('marks partial coverage and uses only costed positions for reference pnl', () => {
    const holdings = [
      stock({ id: 'known', shares: 5, buyPrice: 100, currentPrice: 120 }),
      stock({ id: 'missing', shares: 5, buyPrice: 0, currentPrice: 120 }),
    ];

    expect(computeFamilyPnl(holdings, 'MSFT', ['MSFT'], {})).toEqual({
      marketValue: 1200,
      costBasis: 500,
      pnl: 100,
      pnlPct: 20,
      coverage: 'partial',
    });
  });

  it('falls back to quant holding costs and omits a percentage when all costs are unavailable', () => {
    const costs: Record<string, QuantHoldingCost> = {
      MSFT: { weighted_average_cost: 90, currency: 'USD', coverage: 'complete', auto_fill_allowed: true },
    };
    expect(computeFamilyPnl([stock({ buyPrice: 0 })], 'MSFT', ['MSFT'], costs).pnlPct).toBeCloseTo(-11.111111, 5);

    expect(computeFamilyPnl([stock({ buyPrice: 0 })], 'MSFT', ['MSFT'], {})).toEqual({
      marketValue: 800,
      costBasis: 0,
      pnl: 0,
      pnlPct: null,
      coverage: 'unavailable',
    });
  });
});
