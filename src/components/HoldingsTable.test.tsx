import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../metrics';
import type { ExchangeRates } from '../types';
import { HoldingsTable } from './HoldingsTable';

const rates: ExchangeRates = {
  USD: 1,
  CNY: 7,
  HKD: 7.8,
  JPY: 155,
  EUR: 0.92,
  GBP: 0.79,
  updatedAt: null,
  source: 'fallback',
};

describe('HoldingsTable responsive views', () => {
  it('offers a mobile card list and desktop table without hiding option or cost status', () => {
    const metrics = computeMetrics({
      holdings: [{
        id: 'igv-call',
        symbol: 'IGV',
        name: 'IGV CALL',
        shares: 2,
        buyPrice: 0,
        currentPrice: 19.3,
        sector: '科技',
        currency: 'USD',
        assetType: 'option',
        missingFields: ['成本待核对'],
        option: {
          underlying: 'IGV',
          optionType: 'call',
          strike: 80,
          expiration: '2027-01-15',
          contractMultiplier: 100,
          delta: 0.79,
          theta: null,
          gamma: null,
          vega: null,
          impliedVolatility: null,
          underlyingPrice: 94.77,
        },
      }],
      cash: [],
      updatedAt: '2026-07-25T00:00:00.000Z',
    }, rates).holdingsMetrics;

    const html = renderToStaticMarkup(
      <HoldingsTable
        metrics={metrics}
        displayCurrency="USD"
        rates={rates}
        onAdd={() => undefined}
        onUpdate={() => undefined}
        onDelete={() => undefined}
      />,
    );

    const mobileList = html.match(/<section[^>]*aria-label="移动端持仓列表"[^>]*>/)?.[0] ?? '';
    const mobileStart = html.indexOf(mobileList);
    const mobileMarkup = html.slice(mobileStart, html.indexOf('</section>', mobileStart));
    expect(mobileList).toContain('md:hidden');
    expect(mobileMarkup).not.toContain('overflow-x');
    expect(mobileMarkup).not.toContain('<table');
    expect(mobileMarkup).toContain('张数');
    expect(mobileMarkup).toContain('市值');
    expect(mobileMarkup).toContain('盈亏');
    expect(mobileMarkup).toContain('min-h-11');
    expect(html).toMatch(/aria-label="桌面端持仓表"[^>]*class="[^"]*hidden[^"]*md:block/);
    expect(html.match(/IGV CALL 80 · 2027-01-15/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html.match(/成本待补/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html.match(/aria-label="删除 IGV"/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
