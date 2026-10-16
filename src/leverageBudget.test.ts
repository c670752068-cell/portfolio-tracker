import { describe, expect, it } from 'vitest';
import { buildLeverageBudget, LEVERAGE_BUDGET_CAP, LEVERAGE_CRASH_DRAWDOWN } from './leverageBudget';
import { computeMetrics } from './metrics';
import type { ExchangeRates, Holding, PortfolioState } from './types';

const rates: ExchangeRates = { USD: 1, CNY: 7, HKD: 7.8, JPY: 155, EUR: 0.92, GBP: 0.79, updatedAt: null, source: 'fallback' };

function holding(symbol: string, marketValue: number, overrides: Partial<Holding> = {}): Holding {
  return {
    id: `h-${symbol}-${marketValue}`, symbol, name: symbol, shares: 1, buyPrice: marketValue,
    currentPrice: marketValue, marketValueOverride: marketValue, sector: '', currency: 'USD',
    assetType: 'etf', ...overrides,
  };
}

function metricsFor(holdings: Holding[], cash = 0) {
  const state: PortfolioState = {
    holdings, cash: cash ? [{ amount: cash, currency: 'USD', source: 'manual' }] : [],
    updatedAt: '2026-10-16T00:00:00.000Z',
  };
  return computeMetrics(state, rates);
}

describe('杠杆 ETF 预算', () => {
  it('上限 50%，按市值算，-80% 情景用 0.8', () => {
    expect(LEVERAGE_BUDGET_CAP).toBe(0.5);
    expect(LEVERAGE_CRASH_DRAWDOWN).toBe(0.8);
  });

  it('真实持仓：五只杠杆 ETF 共 $21,694.20，占 11.70%，等效敞口 $61,159.20', () => {
    const budget = buildLeverageBudget(metricsFor([
      holding('AVL', 1_720),
      holding('FAS', 5_200.3),
      holding('NAIL', 1_471.2),
      holding('TSLL', 2_203.4),
      holding('UDOW', 11_099.3),
      holding('SGOV', 136_633.86),
      holding('TSLA', 6_241.72, { assetType: 'stock' }),
    ], 20_849.93));

    expect(budget.value).toBeCloseTo(21_694.2, 2);
    expect(budget.weight).toBeCloseTo(0.117, 4);
    expect(budget.exposure).toBeCloseTo(61_159.2, 2);
    expect(budget.exposureWeight).toBeCloseTo(0.32983, 4);
    expect(budget.overLimit).toBe(false);
    expect(budget.nearLimit).toBe(false);
    expect(budget.crashLossWeight).toBeCloseTo(0.0936, 4);
    // 按等效敞口从大到小
    expect(budget.rows.map((row) => row.symbol)).toEqual(['UDOW', 'FAS', 'NAIL', 'TSLL', 'AVL']);
    expect(budget.rows.map((row) => row.factor)).toEqual([3, 3, 3, 2, 2]);
    expect(budget.rows.map((row) => Math.round(row.exposure * 100) / 100)).toEqual([
      33_297.9, 15_600.9, 4_413.6, 4_406.8, 3_440,
    ]);
  });

  it('只看杠杆 ETF：现金、现金类 ETF、正股和期权都不算', () => {
    const budget = buildLeverageBudget(metricsFor([
      holding('TQQQ', 10_000),
      holding('SGOV', 50_000),
      holding('NVDA', 20_000, { assetType: 'stock' }),
      holding('TQQQ', 5_000, {
        assetType: 'option',
        option: {
          underlying: 'TQQQ', optionType: 'call', strike: 100, expiration: '2027-01-15',
          contractMultiplier: 100, delta: 0.5, theta: null, gamma: null, vega: null,
          impliedVolatility: null, underlyingPrice: 100,
        },
      }),
    ], 20_000));

    expect(budget.rows.map((row) => row.symbol)).toEqual(['TQQQ']);
    expect(budget.value).toBe(10_000);
    expect(budget.weight).toBeCloseTo(10_000 / 105_000, 6);
  });

  it('达到上限的 80%（40%）变黄，达到 50% 变红并给出超出金额', () => {
    const near = buildLeverageBudget(metricsFor([holding('TQQQ', 42_000), holding('SGOV', 58_000)]));
    expect(near.weight).toBeCloseTo(0.42, 6);
    expect(near.nearLimit).toBe(true);
    expect(near.overLimit).toBe(false);
    expect(near.remainingValue).toBeCloseTo(8_000, 6);

    const over = buildLeverageBudget(metricsFor([holding('TQQQ', 60_000), holding('SGOV', 40_000)]));
    expect(over.overLimit).toBe(true);
    expect(over.overByValue).toBeCloseTo(10_000, 6);
    expect(over.remainingValue).toBe(0);
    expect(over.crashLossWeight).toBeCloseTo(0.48, 6);
  });

  it('反向 ETF 按绝对值占用额度', () => {
    const budget = buildLeverageBudget(metricsFor([
      holding('SQQQ', 10_000, { leverageFactor: -3 }),
      holding('SGOV', 90_000),
    ]));

    expect(budget.rows[0]).toMatchObject({ symbol: 'SQQQ', factor: -3, exposure: 30_000 });
    expect(budget.value).toBe(10_000);
    expect(budget.weight).toBeCloseTo(0.1, 6);
  });

  it('没有杠杆仓时给出空清单和零占比', () => {
    const budget = buildLeverageBudget(metricsFor([holding('SGOV', 100_000)]));

    expect(budget.rows).toEqual([]);
    expect(budget.value).toBe(0);
    expect(budget.weight).toBe(0);
    expect(budget.remainingValue).toBeCloseTo(50_000, 6);
    expect(budget.crashLossWeight).toBe(0);
  });
});
