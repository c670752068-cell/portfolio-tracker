import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../metrics';
import type { ExchangeRates } from '../types';
import { Summary } from './Summary';

const rates: ExchangeRates = {
  USD: 1, CNY: 6.7776, HKD: 7.8386, JPY: 155, EUR: 0.92, GBP: 0.79,
  updatedAt: '2026-07-15', source: 'live',
};

describe('Summary cards', () => {
  it('omits the misleading total PnL card while retaining portfolio value cards', () => {
    const metrics = computeMetrics({
      holdings: [{
        id: 'msft', symbol: 'MSFT', name: 'Microsoft', shares: 2, buyPrice: 100,
        currentPrice: 120, sector: '科技', currency: 'USD', assetType: 'stock',
      }],
      cash: [],
      updatedAt: '2026-07-15T00:00:00.000Z',
    }, rates);

    const html = renderToStaticMarkup(
      <Summary
        metrics={metrics}
        rates={rates}
        displayCurrency="USD"
        onDisplayCurrencyChange={() => undefined}
        valueHistory={[]}
        rateError=""
        quoteStatus={{ loading: false, lastSyncedAt: null, error: '', summary: '' }}
        canRefreshQuotes={false}
        onRefreshQuotes={() => undefined}
        exposureTargetPct={100}
      />,
    );

    expect(html).not.toContain('总盈亏');
    expect(html).toContain('总资产（USD）');
    expect(html).toContain('持仓市值（USD）');
  });
});
