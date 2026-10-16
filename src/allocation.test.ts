import { describe, expect, it } from 'vitest';
import { buildAllocationSlices, buildEffectiveExposureSlices, buildOptionBudget } from './allocation';
import { computeMetrics } from './metrics';
import { quantAnalysisFixture } from './testFixtures/quantAnalysis';
import type { ExchangeRates, Holding, PortfolioState, QuantAnalysisSnapshot } from './types';

const rates: ExchangeRates = { USD: 1, CNY: 7, HKD: 7.8, JPY: 155, EUR: 0.92, GBP: 0.79, updatedAt: null, source: 'fallback' };

function row(id: string, symbol: string, value: number): Holding {
  return {
    id, symbol, name: symbol, shares: value, buyPrice: 1, currentPrice: 1,
    sector: '科技', currency: 'USD', assetType: symbol === 'SGOV' ? 'etf' : 'stock',
  };
}

function optionRow(id: string, underlying: string, marketValue: number): Holding {
  return {
    id,
    symbol: underlying,
    name: `${underlying} Call`,
    shares: 1,
    buyPrice: Math.abs(marketValue) / 100,
    currentPrice: Math.abs(marketValue) / 100,
    marketValueOverride: marketValue,
    sector: '期权',
    currency: 'USD',
    assetType: 'option',
    option: {
      underlying,
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

  it('separates market value from underlying-equivalent risk exposure', () => {
    const state: PortfolioState = {
      holdings: [
        {
          ...row('tqqq', 'TQQQ', 10),
          shares: 10,
          currentPrice: 100,
          assetType: 'leveraged_etf',
          leverageFactor: 3,
        },
        {
          ...row('metu', 'METU', 10),
          shares: 10,
          currentPrice: 100,
          assetType: 'leveraged_etf',
          leverageFactor: 2,
        },
        { ...row('igv-shares', 'IGV', 10), shares: 10, currentPrice: 100, assetType: 'etf' },
        {
          ...row('igv-option', 'IGV', 1),
          shares: 1,
          currentPrice: 10,
          assetType: 'option',
          option: {
            underlying: 'IGV', optionType: 'call', strike: 100, expiration: '2026-12-18',
            contractMultiplier: 100, delta: null, theta: null, gamma: null, vega: null,
            impliedVolatility: null, underlyingPrice: 100,
          },
        },
        { ...row('sgov', 'SGOV', 500), shares: 500, assetType: 'etf' },
      ],
      cash: [{ amount: 1_000, currency: 'USD' }],
      updatedAt: '2026-08-02T00:00:00.000Z',
    };
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.option_exposure = {
      delta_exposure_usd: 5_000,
      items: [{
        symbol: 'IGV', family: 'IGV', delta: 0.5, delta_source: 'estimated',
        delta_notional_usd: 5_000,
      }],
    };
    const metrics = computeMetrics(state, rates);

    const market = buildAllocationSlices(metrics);
    const effective = buildEffectiveExposureSlices(metrics, snapshot);

    expect(market.find((slice) => slice.name === 'TQQQ')?.value).toBe(1_000);
    expect(market.find((slice) => slice.name === 'IGV')?.value).toBe(1_000);
    expect(market.find((slice) => slice.name === '期权（总计）')?.value).toBe(1_000);
    expect(market.map((slice) => slice.name)).toContain('现金');
    expect(market.map((slice) => slice.name)).toContain('现金类 ETF(SGOV等)');

    expect(effective.map((slice) => slice.name)).toEqual(['IGV', 'TQQQ（3×）', 'META']);
    expect(effective.find((slice) => slice.name === 'IGV')).toMatchObject({
      value: 6_000,
      weight: 6 / 11,
      estimated: true,
    });
    expect(effective.find((slice) => slice.name === 'TQQQ（3×）')).toMatchObject({
      value: 3_000,
      weight: 3 / 11,
    });
    expect(effective.find((slice) => slice.name === 'META')).toMatchObject({
      value: 2_000,
      weight: 2 / 11,
    });
    expect(effective.find((slice) => slice.name === 'IGV')?.navWeight).toBeCloseTo(6_000 / 5_500);
  });

  it('falls back to locally entered option Delta when the quant snapshot has no option exposure', () => {
    const state: PortfolioState = {
      holdings: [{
        ...row('msft-option', 'MSFT', 1),
        shares: 1,
        currentPrice: 10,
        assetType: 'option',
        option: {
          underlying: 'MSFT', optionType: 'call', strike: 400, expiration: '2026-12-18',
          contractMultiplier: 100, delta: 0.5, theta: null, gamma: null, vega: null,
          impliedVolatility: null, underlyingPrice: 400,
        },
      }],
      cash: [],
      updatedAt: '2026-08-02T00:00:00.000Z',
    };

    expect(buildEffectiveExposureSlices(computeMetrics(state, rates), null)).toEqual([
      expect.objectContaining({ name: 'MSFT', value: 20_000, weight: 1, estimated: false }),
    ]);
  });
});

describe('buildOptionBudget', () => {
  it('splits option market value into the 5% total, 3% TQQQ, and 2% other limits', () => {
    const metrics = computeMetrics({
      holdings: [
        row('core', 'AAPL', 80_000),
        { ...row('tqqq-etf', 'TQQQ', 10_000), assetType: 'leveraged_etf', leverageFactor: 3 },
        optionRow('tqqq-option', 'US.TQQQ', 4_000),
        optionRow('nvda-option', 'NVDA', 3_000),
      ],
      cash: [{ amount: 3_000, currency: 'USD' }],
      updatedAt: '2026-09-07T00:00:00.000Z',
    }, rates);

    expect(metrics.totalValue).toBe(100_000);
    expect(buildOptionBudget(metrics)).toEqual({
      total: expect.objectContaining({ value: 7_000, weight: 0.07, cap: 0.05, overLimit: true, overByValue: 2_000 }),
      tqqq: expect.objectContaining({ value: 4_000, weight: 0.04, cap: 0.03, overLimit: true, overByValue: 1_000 }),
      other: expect.objectContaining({ value: 3_000, weight: 0.03, cap: 0.02, overLimit: true, overByValue: 1_000 }),
      hasOverLimit: true,
    });
  });

  it('treats 5% / 3% / 2% exactly on the limits as compliant', () => {
    const metrics = computeMetrics({
      holdings: [
        row('core', 'AAPL', 95_000),
        optionRow('tqqq-option', 'TQQQ', 3_000),
        optionRow('other-option', 'IGV', 2_000),
      ],
      cash: [],
      updatedAt: '2026-09-07T00:00:00.000Z',
    }, rates);

    const budget = buildOptionBudget(metrics);

    expect(budget.total).toMatchObject({ weight: 0.05, overLimit: false, remainingValue: 0 });
    expect(budget.tqqq).toMatchObject({ weight: 0.03, overLimit: false, remainingValue: 0 });
    expect(budget.other).toMatchObject({ weight: 0.02, overLimit: false, remainingValue: 0 });
    expect(budget.hasOverLimit).toBe(false);
  });

  it('warns when the other-option bucket exceeds 2% even while total options stay below 5%', () => {
    const metrics = computeMetrics({
      holdings: [row('core', 'AAPL', 96_000), optionRow('other-option', 'NVDA', 4_000)],
      cash: [],
      updatedAt: '2026-09-07T00:00:00.000Z',
    }, rates);

    const budget = buildOptionBudget(metrics);

    expect(budget.total).toMatchObject({ weight: 0.04, overLimit: false });
    expect(budget.tqqq).toMatchObject({ weight: 0, overLimit: false });
    expect(budget.other).toMatchObject({ weight: 0.04, overLimit: true, overByValue: 2_000 });
    expect(budget.hasOverLimit).toBe(true);
  });

  it('uses gross option market value for the safety budget and ignores TQQQ shares', () => {
    const metrics = computeMetrics({
      holdings: [
        { ...row('tqqq-etf', 'TQQQ', 90_000), assetType: 'leveraged_etf', leverageFactor: 3 },
        optionRow('short-tqqq-option', 'TQQQ', -4_000),
      ],
      cash: [{ amount: 14_000, currency: 'USD' }],
      updatedAt: '2026-09-07T00:00:00.000Z',
    }, rates);

    expect(metrics.totalValue).toBe(100_000);
    expect(buildOptionBudget(metrics).tqqq).toMatchObject({
      value: 4_000,
      weight: 0.04,
      overLimit: true,
    });
  });
});
