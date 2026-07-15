import { describe, expect, it } from 'vitest';
import { scenarioFamilyFor, simulateScenario } from './scenario';
import type { Holding, HoldingMetric } from './types';

function metric(holding: Partial<Holding>, marketValue: number): HoldingMetric {
  return {
    holding: {
      id: holding.symbol ?? 'holding',
      symbol: 'NVDA', name: 'Holding', shares: 1, buyPrice: 0, currentPrice: 200,
      sector: '科技', currency: 'USD', assetType: 'stock',
      ...holding,
    },
    marketValueNative: marketValue,
    costNative: 0,
    marketValue,
    cost: 0,
    costKnown: false,
    pnl: 0,
    pnlPct: 0,
    dayChange: 0,
    dayChangeNative: 0,
    dayChangePct: null,
    weight: 0,
    deltaEquivalentShares: null,
    deltaAdjustedExposure: null,
    equivalentExposure: null,
  };
}

const stock = metric({ symbol: 'NVDA', assetType: 'stock', currentPrice: 200 }, 10_000);
const leveraged = metric({ symbol: 'NVDL', assetType: 'leveraged_etf', currentPrice: 100 }, 5_000);
const call = metric({
  symbol: 'NVDA', name: 'NVDA Call', assetType: 'option', shares: 2, currentPrice: 10,
  option: {
    underlying: 'NVDA', optionType: 'call', strike: 220, expiration: '2027-01-15',
    contractMultiplier: 100, delta: 0.8, gamma: 0.01, theta: -0.02, vega: 0.2,
    impliedVolatility: 0.4, underlyingPrice: 200,
  },
}, 2_000);

describe('simulateScenario numerical contract', () => {
  it('computes +1000 for a $10k plain stock moving from 200 to 220', () => {
    const result = simulateScenario({ family: 'NVDA', holdings: [stock], spot: 200, targetPrice: 220, days: 0, totalAssets: 20_000 });

    expect(result.lines[0]).toMatchObject({ symbol: 'NVDA', kind: 'stock', pnl: 1_000, pnlPct: 0.1 });
    expect(result.totalPnl).toBeCloseTo(1_000);
    expect(result.totalPnlPctOfAssets).toBeCloseTo(0.05);
  });

  it('computes +1000 for a $5k 2x ETF on a 10% underlying move', () => {
    const result = simulateScenario({ family: 'NVDA', holdings: [leveraged], spot: 200, targetPrice: 220, days: 0, totalAssets: 20_000 });

    expect(result.lines[0]).toMatchObject({ symbol: 'NVDL', kind: 'leveraged_etf', pnl: 1_000, pnlPct: 0.2 });
  });

  it('uses Delta, Gamma and ten days of Theta to compute +3560 for two calls', () => {
    const result = simulateScenario({ family: 'NVDA', holdings: [call], spot: 200, targetPrice: 220, days: 10, totalAssets: 20_000 });

    expect(result.lines[0]).toMatchObject({ symbol: 'NVDA', kind: 'option', pnl: 3_560, pnlPct: 1.78 });
  });

  it('computes -1540 for the same call at 190 after ten days', () => {
    const result = simulateScenario({ family: 'NVDA', holdings: [call], spot: 200, targetPrice: 190, days: 10, totalAssets: 20_000 });

    expect(result.lines[0]?.pnl).toBeCloseTo(-1_540);
  });

  it('floors a long option loss at its full premium market value', () => {
    const zeroGammaCall = metric({
      ...call.holding,
      option: { ...call.holding.option!, gamma: 0 },
    }, 2_000);
    const result = simulateScenario({ family: 'NVDA', holdings: [zeroGammaCall], spot: 200, targetPrice: 0, days: 30, totalAssets: 20_000 });

    expect(result.lines[0]?.pnl).toBe(-2_000);
  });

  it('excludes an option without Delta and explains why', () => {
    const missingDelta = metric({
      ...call.holding,
      id: 'missing',
      option: { ...call.holding.option!, delta: null },
    }, 2_000);
    const result = simulateScenario({ family: 'NVDA', holdings: [missingDelta], spot: 200, targetPrice: 220, days: 10, totalAssets: 20_000 });

    expect(result.lines).toEqual([]);
    expect(result.excluded).toEqual([expect.objectContaining({ symbol: 'NVDA', reason: expect.stringContaining('Delta') })]);
  });

  it('aggregates only members of the selected family', () => {
    const msft = metric({ symbol: 'MSFT', assetType: 'stock' }, 50_000);
    const result = simulateScenario({ family: 'NVDA', holdings: [stock, leveraged, call, msft], spot: 200, targetPrice: 220, days: 10, totalAssets: 100_000 });

    expect(result.lines.map((line) => line.symbol)).toEqual(['NVDA', 'NVDL', 'NVDA']);
    expect(result.totalPnl).toBeCloseTo(5_560);
  });
});

describe('scenarioFamilyFor', () => {
  it('groups a mapped leveraged ETF and an option under their underlying', () => {
    expect(scenarioFamilyFor(stock.holding)).toBe('NVDA');
    expect(scenarioFamilyFor(leveraged.holding)).toBe('NVDA');
    expect(scenarioFamilyFor(call.holding)).toBe('NVDA');
  });
});
