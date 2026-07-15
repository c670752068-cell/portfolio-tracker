import { describe, expect, it } from 'vitest';
import { computeMetrics, sortHoldingMetrics } from './metrics';
import { leverageFactorFor } from './leverageMap';
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

describe('sortHoldingMetrics', () => {
  it('orders holdings by market value descending without mutating the input', () => {
    const state: PortfolioState = {
      holdings: [
        { id: 'aapl', symbol: 'AAPL', name: 'Apple', shares: 10, buyPrice: 1, currentPrice: 1, sector: '科技', currency: 'USD' },
        { id: 'msft', symbol: 'MSFT', name: 'Microsoft', shares: 30, buyPrice: 1, currentPrice: 1, sector: '科技', currency: 'USD' },
        { id: 'nvda', symbol: 'NVDA', name: 'Nvidia', shares: 20, buyPrice: 1, currentPrice: 1, sector: '科技', currency: 'USD' },
      ],
      cash: [],
      updatedAt: '2026-07-15T00:00:00.000Z',
    };
    const original = computeMetrics(state, usdRates).holdingsMetrics;

    expect(sortHoldingMetrics(original).map((metric) => metric.holding.symbol)).toEqual(['MSFT', 'NVDA', 'AAPL']);
    expect(original.map((metric) => metric.holding.symbol)).toEqual(['AAPL', 'MSFT', 'NVDA']);
  });
});

describe('leverage-adjusted equivalent exposure', () => {
  it('maps a $5,000 TSLL position to $10,000 of TSLA underlying exposure', () => {
    const state: PortfolioState = {
      holdings: [{
        id: 'tsll', symbol: 'TSLL', name: 'TSLA Bull 2X', shares: 50,
        buyPrice: 90, currentPrice: 100, sector: '科技', currency: 'USD', assetType: 'leveraged_etf',
      }],
      cash: [], updatedAt: 'old',
    };

    const metrics = computeMetrics(state, usdRates);

    expect(metrics.holdingsMetrics[0]?.equivalentExposure).toBe(10_000);
    expect(metrics.leveragedEtfExposure).toBe(10_000);
    expect(metrics.equivalentExposureTotal).toBe(10_000);
    expect(metrics.underlyingExposure.TSLA).toBe(10_000);
  });

  it('counts an option without Delta as uncomputable instead of treating premium as exposure', () => {
    const state: PortfolioState = {
      holdings: [{
        id: 'igv', symbol: 'IGV', name: 'IGV CALL', shares: 2, buyPrice: 5,
        currentPrice: 18, sector: '科技', currency: 'USD', assetType: 'option',
        option: {
          underlying: 'IGV', optionType: 'call', strike: 80, expiration: '2027-01-15',
          contractMultiplier: 100, delta: null, theta: null, gamma: null, vega: null,
          impliedVolatility: null, underlyingPrice: 93.76,
        },
      }],
      cash: [], updatedAt: 'old',
    };

    const metrics = computeMetrics(state, usdRates);

    expect(metrics.holdingsMetrics[0]?.equivalentExposure).toBeNull();
    expect(metrics.uncomputableOptions).toBe(1);
    expect(metrics.optionDeltaExposure).toBe(0);
  });

  it('assigns zero equivalent exposure to SGOV and excludes cash from the total', () => {
    const state: PortfolioState = {
      holdings: [{
        id: 'sgov', symbol: 'SGOV', name: 'Treasury ETF', shares: 400,
        buyPrice: 100, currentPrice: 100, sector: 'ETF / 指数', currency: 'USD', assetType: 'etf',
      }],
      cash: [{ amount: 10_000, currency: 'USD' }], updatedAt: 'old',
    };

    const metrics = computeMetrics(state, usdRates);

    expect(metrics.holdingsMetrics[0]?.equivalentExposure).toBe(0);
    expect(metrics.equivalentExposureTotal).toBe(0);
    expect(metrics.equivalentExposurePct).toBe(0);
  });

  it('makes total equivalent exposure equal plain equity plus leveraged ETF plus option Delta exposure', () => {
    const state: PortfolioState = {
      holdings: [
        { id: 'msft', symbol: 'MSFT', name: 'Microsoft', shares: 10, buyPrice: 100, currentPrice: 100, sector: '科技', currency: 'USD', assetType: 'stock' },
        { id: 'tsll', symbol: 'TSLL', name: 'TSLA Bull 2X', shares: 10, buyPrice: 100, currentPrice: 100, sector: '科技', currency: 'USD', assetType: 'leveraged_etf' },
        {
          id: 'igv', symbol: 'IGV', name: 'IGV CALL', shares: 1, buyPrice: 5, currentPrice: 10,
          sector: '科技', currency: 'USD', assetType: 'option',
          option: { underlying: 'IGV', optionType: 'call', strike: 80, expiration: '2027-01-15', contractMultiplier: 100, delta: 0.5, theta: null, gamma: null, vega: null, impliedVolatility: null, underlyingPrice: 100 },
        },
      ], cash: [{ amount: 3000, currency: 'USD' }], updatedAt: 'old',
    };

    const metrics = computeMetrics(state, usdRates);

    expect(metrics.plainEquityExposure).toBe(1000);
    expect(metrics.leveragedEtfExposure).toBe(2000);
    expect(metrics.optionDeltaExposure).toBe(5000);
    expect(metrics.equivalentExposureTotal).toBe(8000);
    expect(metrics.equivalentExposurePct).toBe(8000 / 6000);
  });

  it('converts an option on a 2x ETF into its underlying stock equivalent exposure', () => {
    const state: PortfolioState = {
      holdings: [{
        id: 'msfu-call', symbol: 'MSFU', name: 'MSFU Call', shares: 1, buyPrice: 1,
        currentPrice: 2, sector: '科技', currency: 'USD', assetType: 'option',
        option: {
          underlying: 'MSFU', optionType: 'call', strike: 30, expiration: '2027-01-15',
          contractMultiplier: 100, delta: 0.5, theta: 0, gamma: 0, vega: 0.1,
          impliedVolatility: 0.5, underlyingPrice: 25,
        },
      }],
      cash: [], updatedAt: 'old',
    };

    const metrics = computeMetrics(state, usdRates);

    expect(metrics.holdingsMetrics[0]?.deltaEquivalentShares).toBe(50);
    expect(metrics.holdingsMetrics[0]?.deltaAdjustedExposure).toBe(2_500);
    expect(metrics.optionDeltaExposure).toBe(2_500);
    expect(metrics.underlyingExposure.MSFT).toBe(2_500);
  });

  it('prefers a manual leverage factor, then map/default, and leaves ordinary assets at 1x', () => {
    const base = { id: 'x', name: '', shares: 1, buyPrice: 1, currentPrice: 1, sector: '', currency: 'USD' as const };
    expect(leverageFactorFor({ ...base, symbol: 'TSLL', assetType: 'leveraged_etf', leverageFactor: 1.5 })).toBe(1.5);
    expect(leverageFactorFor({ ...base, symbol: 'NVDL', assetType: 'leveraged_etf' })).toBe(2);
    expect(leverageFactorFor({ ...base, symbol: 'UNKNOWN', assetType: 'leveraged_etf' })).toBe(2);
    expect(leverageFactorFor({ ...base, symbol: 'MSFT', assetType: 'stock' })).toBe(1);
  });
});
