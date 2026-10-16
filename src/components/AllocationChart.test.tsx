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
  it('mounts one responsive chart so hidden breakpoint containers cannot report zero dimensions', () => {
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

    expect(html.match(/data-allocation-chart="true"/g)).toHaveLength(1);
    expect(html).not.toContain('data-allocation-wide="true"');
    expect(html).not.toContain('data-allocation-narrow="true"');
    expect(html).toContain('MSFT');
    expect(html).toContain('现金');
    expect(html).toContain('实际市值');
    expect(html).toContain('等效敞口');
    expect(html).toContain('按当前市值计算');
    expect(html).toContain('总实际市值 $5,200.00');
    expect(html).toContain('期权资金预算');
    expect(html).toContain('期权总计');
    expect(html).toContain('TQQQ 期权');
    expect(html).toContain('个股 / 其他期权');
    expect(html).not.toContain('期权预算超限');
  });

  it('shows total-asset option weights and highlights every exceeded 5% / 3% / 2% limit', () => {
    const option = (id: string, underlying: string, marketValue: number) => ({
      id,
      symbol: underlying,
      name: `${underlying} Call`,
      shares: 1,
      buyPrice: marketValue / 100,
      currentPrice: marketValue / 100,
      marketValueOverride: marketValue,
      sector: '期权',
      currency: 'USD' as const,
      assetType: 'option' as const,
      option: {
        underlying,
        optionType: 'call' as const,
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
    });
    const metrics = computeMetrics({
      holdings: [
        {
          id: 'core', symbol: 'AAPL', name: 'Apple', shares: 90_000, buyPrice: 1,
          currentPrice: 1, sector: '科技', currency: 'USD', assetType: 'stock',
        },
        option('tqqq-option', 'TQQQ', 4_000),
        option('nvda-option', 'NVDA', 3_000),
      ],
      cash: [{ currency: 'USD', amount: 3_000 }],
      updatedAt: '2026-09-07T00:00:00.000Z',
    }, rates);

    const html = renderToStaticMarkup(
      <AllocationChart metrics={metrics} displayCurrency="USD" rates={rates} />,
    );

    expect(html).toContain('期权（总计）');
    expect(html).toContain('$7,000.00');
    expect(html).toContain('占总资产 7.00% · 上限 5.00%');
    expect(html).toContain('占总资产 4.00% · 上限 3.00%');
    expect(html).toContain('占总资产 3.00% · 上限 2.00%');
    expect(html).toContain('期权预算超限');
    expect(html).toContain('暂停新增期权');
    expect(html.match(/已超出 \$1,000\.00/g)).toHaveLength(2);
  });
});
