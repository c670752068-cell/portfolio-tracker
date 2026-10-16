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

describe('杠杆 ETF 预算卡片', () => {
  const metrics = computeMetrics({
    holdings: [
      { id: 'udow', symbol: 'UDOW', name: 'UDOW 3× 杠杆 ETF', shares: 170, buyPrice: 63.14, currentPrice: 65.29, marketValueOverride: 11_099.3, sector: '', currency: 'USD', assetType: 'leveraged_etf' },
      { id: 'tsll', symbol: 'TSLL', name: 'TSLL 2× 杠杆 ETF', shares: 230, buyPrice: 10.16, currentPrice: 9.58, marketValueOverride: 2_203.4, sector: '', currency: 'USD', assetType: 'leveraged_etf' },
      { id: 'sgov', symbol: 'SGOV', name: 'SGOV', shares: 1_359, buyPrice: 100.52, currentPrice: 100.54, marketValueOverride: 136_633.86, sector: '', currency: 'USD', assetType: 'etf' },
    ],
    cash: [{ currency: 'USD', amount: 1_000 }],
    updatedAt: '2026-10-16T00:00:00.000Z',
  }, rates);

  it('放在期权资金预算正下方，按市值给出 50% 上限、剩余额度和等效敞口', () => {
    const html = renderToStaticMarkup(
      <AllocationChart metrics={metrics} displayCurrency="USD" rates={rates} />,
    );

    expect(html.indexOf('杠杆 ETF 预算')).toBeGreaterThan(html.indexOf('期权资金预算'));
    expect(html).toContain('data-leverage-budget="true"');
    expect(html).toContain('杠杆 ETF 总计');
    expect(html).toContain('$13,302.70');
    expect(html).toContain('上限 50.00%');
    expect(html).toContain('UDOW');
    expect(html).toContain('3×');
    expect(html).toContain('2×');
    expect(html).toContain('$33,297.90');
    expect(html).toContain('合计等效敞口');
    expect(html).toContain('仅作仓位提醒，不自动交易');
    expect(html).not.toContain('杠杆预算超限');
  });

  it('超过 50% 时提示超限', () => {
    const over = computeMetrics({
      holdings: [
        { id: 'tqqq', symbol: 'TQQQ', name: 'TQQQ', shares: 1, buyPrice: 60_000, currentPrice: 60_000, marketValueOverride: 60_000, sector: '', currency: 'USD', assetType: 'leveraged_etf' },
        { id: 'sgov', symbol: 'SGOV', name: 'SGOV', shares: 1, buyPrice: 40_000, currentPrice: 40_000, marketValueOverride: 40_000, sector: '', currency: 'USD', assetType: 'etf' },
      ],
      cash: [],
      updatedAt: '2026-10-16T00:00:00.000Z',
    }, rates);

    const html = renderToStaticMarkup(
      <AllocationChart metrics={over} displayCurrency="USD" rates={rates} />,
    );

    expect(html).toContain('杠杆预算超限');
    expect(html).toContain('$10,000.00');
  });
});
