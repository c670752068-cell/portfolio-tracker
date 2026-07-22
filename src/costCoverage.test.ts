import { describe, expect, it } from 'vitest';
import { analyzeCostCoverage } from './costCoverage';
import type { Holding, QuantHoldingCost } from './types';

function holding(overrides: Partial<Holding>): Holding {
  return {
    id: 'holding', symbol: 'MSFT', name: 'Microsoft', shares: 1,
    buyPrice: 0, currentPrice: 100, sector: '科技', currency: 'USD',
    assetType: 'stock', broker: 'IBKR', ...overrides,
  };
}

describe('analyzeCostCoverage', () => {
  it('classifies option, incomplete quant, and manual cost gaps without inventing costs', () => {
    const holdings = [
      holding({ id: 'option', symbol: 'NVDA', assetType: 'option', broker: 'FUTU' }),
      holding({ id: 'partial', symbol: 'MSFT', broker: 'IBKR' }),
      holding({ id: 'manual', symbol: 'AAPL', broker: 'LONGPORT' }),
      holding({ id: 'costed', symbol: 'AMZN', buyPrice: 180, broker: 'IBKR' }),
    ];
    const holdingCosts: Record<string, QuantHoldingCost> = {
      MSFT: { weighted_average_cost: 300, currency: 'USD', coverage: 'partial', auto_fill_allowed: false },
      AAPL: { weighted_average_cost: null, currency: 'USD', coverage: 'complete', auto_fill_allowed: true },
    };

    expect(analyzeCostCoverage(holdings, holdingCosts)).toEqual({
      total: 4,
      costed: 1,
      gaps: [
        { symbol: 'NVDA', assetType: 'option', broker: 'FUTU', reason: 'option_no_source' },
        { symbol: 'MSFT', assetType: 'stock', broker: 'IBKR', reason: 'quant_coverage_incomplete' },
        { symbol: 'AAPL', assetType: 'stock', broker: 'LONGPORT', reason: 'manual_missing' },
      ],
    });
  });

  it('counts complete quant costs and option-owned costs as covered', () => {
    const holdings = [
      holding({ id: 'stock', symbol: 'MSFT' }),
      holding({ id: 'option', symbol: 'NVDA', assetType: 'option', costOverride: 2_000 }),
    ];
    const holdingCosts: Record<string, QuantHoldingCost> = {
      MSFT: { weighted_average_cost: 300, currency: 'USD', coverage: 'complete', auto_fill_allowed: true },
    };

    expect(analyzeCostCoverage(holdings, holdingCosts)).toEqual({ total: 2, costed: 2, gaps: [] });
  });

  it('reports missing and disabled quant coverage instead of treating it as a manual cost', () => {
    const holdings = [
      holding({ id: 'missing', symbol: 'MSFT' }),
      holding({ id: 'disabled', symbol: 'NVDA' }),
    ];
    const holdingCosts: Record<string, QuantHoldingCost> = {
      NVDA: { weighted_average_cost: 100, currency: 'USD', coverage: 'complete', auto_fill_allowed: false },
    };

    expect(analyzeCostCoverage(holdings, holdingCosts).gaps.map((gap) => gap.reason)).toEqual([
      'quant_coverage_incomplete',
      'quant_coverage_incomplete',
    ]);
  });
});
