import { describe, expect, it } from 'vitest';
import { isCashEquivalent } from './assetClass';
import type { Holding } from './types';

function holding(overrides: Partial<Holding> = {}): Holding {
  return {
    id: 'holding-1',
    symbol: 'AAPL',
    name: 'Apple',
    shares: 1,
    buyPrice: 100,
    currentPrice: 120,
    sector: '科技',
    currency: 'USD',
    assetType: 'stock',
    ...overrides,
  };
}

describe('isCashEquivalent', () => {
  it('recognises SGOV case-insensitively from the built-in symbol set', () => {
    expect(isCashEquivalent(holding({ symbol: 'sgov', assetType: 'etf' }))).toBe(true);
  });

  it('respects a manual cash-equivalent override', () => {
    expect(isCashEquivalent(holding({ symbol: 'CUSTOM', cashEquivalent: true }))).toBe(true);
  });

  it('never classifies an option as a cash equivalent', () => {
    expect(isCashEquivalent(holding({
      symbol: 'SGOV',
      assetType: 'option',
      cashEquivalent: true,
      option: {
        underlying: 'SGOV',
        optionType: 'call',
        strike: 100,
        expiration: '2027-01-15',
        contractMultiplier: 100,
        delta: 0.5,
        theta: null,
        gamma: null,
        vega: null,
        impliedVolatility: null,
        underlyingPrice: 100,
      },
    }))).toBe(false);
  });
});
