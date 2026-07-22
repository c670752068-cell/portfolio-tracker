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
  it('never derives an option cost from the underlying share holding cost', () => {
    const holdings = [
      stock({
        id: 'nvda-stock', symbol: 'NVDA', name: '英伟达', shares: 10,
        buyPrice: 203.15, currentPrice: 210.02,
      }),
      stock({
        id: 'nvda-call', symbol: 'NVDA', name: 'NVDA Call', shares: 1,
        buyPrice: 0, currentPrice: 20, marketValueOverride: 2_000,
        assetType: 'option',
        option: {
          underlying: 'NVDA', optionType: 'call', strike: 260,
          expiration: '2028-01-21', contractMultiplier: 100,
          delta: 0.5, theta: null, gamma: null, vega: null,
          impliedVolatility: null, underlyingPrice: 210.02,
        },
      }),
    ];
    const costs: Record<string, QuantHoldingCost> = {
      NVDA: {
        weighted_average_cost: 203.15, currency: 'USD',
        coverage: 'complete', auto_fill_allowed: true,
      },
    };

    const result = computeFamilyPnl(holdings, 'NVDA', ['NVDA'], costs);

    expect(result.costBasis).toBeCloseTo(2_031.5, 5);
    expect(result.coverage).toBe('partial');
    expect(result.unknownCostHoldings).toEqual(['NVDA（期权）']);
    expect(result.pnlPct).toBeCloseTo(((2_100.2 - 2_031.5) / 2_031.5) * 100, 5);
  });

  it('computes a complete losing family from current market value and cost', () => {
    expect(computeFamilyPnl([stock()], 'MSFT', ['MSFT'], {})).toEqual({
      marketValue: 800,
      costBasis: 1000,
      pnl: -200,
      pnlPct: -20,
      coverage: 'complete',
      unknownCostHoldings: [],
    });
  });

  it('uses an option own buy price before any underlying share holding cost', () => {
    const option = stock({
      id: 'igv-call', symbol: 'IGV CALL', name: 'IGV Call', shares: 2,
      buyPrice: 2, currentPrice: 3, assetType: 'option',
      option: {
        underlying: 'IGV', optionType: 'call', strike: 80, expiration: '2027-01-15',
        contractMultiplier: 100, delta: 0.8, theta: null, gamma: null, vega: null,
        impliedVolatility: null, underlyingPrice: 95,
      },
    });

    const costs: Record<string, QuantHoldingCost> = {
      IGV: {
        weighted_average_cost: 95, currency: 'USD',
        coverage: 'complete', auto_fill_allowed: true,
      },
    };

    expect(computeFamilyPnl([option], 'IGV', ['IGV'], costs)).toEqual({
      marketValue: 600,
      costBasis: 400,
      pnl: 200,
      pnlPct: 50,
      coverage: 'complete',
      unknownCostHoldings: [],
    });
  });

  it('uses an option cost override before its own buy price', () => {
    const option = stock({
      id: 'igv-call-override', symbol: 'IGV', name: 'IGV Call', shares: 2,
      buyPrice: 2, costOverride: 500, currentPrice: 3, assetType: 'option',
      option: {
        underlying: 'IGV', optionType: 'call', strike: 80,
        expiration: '2027-01-15', contractMultiplier: 100,
        delta: 0.8, theta: null, gamma: null, vega: null,
        impliedVolatility: null, underlyingPrice: 95,
      },
    });
    const costs: Record<string, QuantHoldingCost> = {
      IGV: {
        weighted_average_cost: 95, currency: 'USD',
        coverage: 'complete', auto_fill_allowed: true,
      },
    };

    expect(computeFamilyPnl([option], 'IGV', ['IGV'], costs)).toEqual({
      marketValue: 600,
      costBasis: 500,
      pnl: 100,
      pnlPct: 20,
      coverage: 'complete',
      unknownCostHoldings: [],
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
      unknownCostHoldings: ['MSFT'],
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
      unknownCostHoldings: ['MSFT'],
    });
  });
});
