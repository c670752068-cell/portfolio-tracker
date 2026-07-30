import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../metrics';
import type { ExchangeRates } from '../types';
import { AllocationChart } from './AllocationChart';

const rates: ExchangeRates = {
  USD: 1, CNY: 6.7776, HKD: 7.8386, JPY: 155, EUR: 0.92, GBP: 0.79,
  updatedAt: '2026-07-30', source: 'live',
};

describe('AllocationChart', () => {
  it('keeps both the wide chart and narrow detail layout mounted so resizing cannot leave an empty container', () => {
    const metrics = computeMetrics({
      holdings: [{
        id: 'msft', symbol: 'MSFT', name: 'Microsoft', shares: 10, buyPrice: 400,
        currentPrice: 420, sector: '科技', currency: 'USD', assetType: 'stock',
      }],
      cash: [{ currency: 'USD', amount: 1_000 }],
      updatedAt: '2026-07-30T00:00:00.000Z',
    }, rates);

    const html = renderToStaticMarkup(
      <AllocationChart metrics={metrics} displayCurrency="USD" rates={rates} />,
    );

    expect(html).toContain('data-allocation-wide="true"');
    expect(html).toContain('data-allocation-narrow="true"');
    expect(html).toContain('MSFT');
    expect(html).toContain('现金');
  });
});
