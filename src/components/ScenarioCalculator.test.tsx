import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../metrics';
import type { ExchangeRates, PortfolioState } from '../types';
import { ScenarioCalculator } from './ScenarioCalculator';

const rates: ExchangeRates = {
  USD: 1, CNY: 7, HKD: 7.8, JPY: 155, EUR: 0.92, GBP: 0.79,
  updatedAt: '2026-07-15', source: 'fallback',
};

describe('ScenarioCalculator position identity', () => {
  it('distinguishes an IGV ETF at Longport from an IGV option at Futu', () => {
    const state: PortfolioState = {
      holdings: [
        {
          id: 'longport-igv', symbol: 'IGV', name: 'IGV', shares: 72, buyPrice: 0,
          currentPrice: 94, sector: 'ETF / 指数', currency: 'USD', assetType: 'etf',
          marketValueOverride: 6_768, broker: 'LONGPORT', source: 'quant-sync',
        },
        {
          id: 'futu-igv-call', symbol: 'IGV', name: 'IGV Call', shares: 2, buyPrice: 0,
          currentPrice: 19.3, sector: '科技', currency: 'USD', assetType: 'option',
          marketValueOverride: 3_860, broker: 'FUTU', source: 'quant-sync',
          option: {
            underlying: 'IGV', optionType: 'call', strike: 80, expiration: '2027-01-15',
            contractMultiplier: 100, delta: 0.8, gamma: 0, theta: 0, vega: 0.1,
            impliedVolatility: 0.3, underlyingPrice: 94,
          },
        },
      ],
      cash: [], updatedAt: '2026-07-15',
    };

    const html = renderToStaticMarkup(
      <ScenarioCalculator metrics={computeMetrics(state, rates)} displayCurrency="USD" rates={rates} />,
    );

    expect(html).toContain('IGV · 普通 ETF · LONGPORT');
    expect(html).toContain('IGV · 期权 · FUTU');
    expect(html).not.toContain('正股 / 普通 ETF');
  });
});
