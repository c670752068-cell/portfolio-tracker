import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../metrics';
import type { ExchangeRates } from '../types';
import { Summary } from './Summary';

const rates: ExchangeRates = {
  USD: 1, CNY: 6.7776, HKD: 7.8386, JPY: 155, EUR: 0.92, GBP: 0.79,
  updatedAt: '2026-07-15', source: 'live',
};

const quantProps = {
  quantStatus: { loading: false, asOf: null, pushedAt: null, stale: false, error: '', summary: '' },
  quantSyncEnabled: false,
  quantGatewayAvailable: false,
  quantTokenConfigured: false,
  onRefreshQuant: () => undefined,
  oneTapRefreshState: { phase: 'idle' as const, message: '' },
  canOneTapRefresh: false,
  oneTapCooldownSeconds: 0,
  onOneTapRefresh: () => undefined,
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
        dayChangeStatusText="已收盘"
        canRefreshQuotes={false}
        onRefreshQuotes={() => undefined}
        exposureTargetPct={100}
        {...quantProps}
      />,
    );

    expect(html).not.toContain('总盈亏');
    expect(html).toContain('总资产（USD）');
    expect(html).toContain('持仓市值（USD）');
    expect(html).toContain('已收盘');
  });

  it('shows equivalent exposure decomposition, target, and uncomputable option warning', () => {
    const metrics = computeMetrics({
      holdings: [
        { id: 'msft', symbol: 'MSFT', name: 'Microsoft', shares: 10, buyPrice: 100, currentPrice: 100, sector: '科技', currency: 'USD', assetType: 'stock' },
        {
          id: 'igv', symbol: 'IGV', name: 'IGV CALL', shares: 1, buyPrice: 10, currentPrice: 10,
          sector: '科技', currency: 'USD', assetType: 'option',
          option: { underlying: 'IGV', optionType: 'call', strike: 80, expiration: '2027-01-15', contractMultiplier: 100, delta: null, theta: null, gamma: null, vega: null, impliedVolatility: null, underlyingPrice: 95 },
        },
      ], cash: [], updatedAt: 'old',
    }, rates);

    const html = renderToStaticMarkup(
      <Summary
        metrics={metrics} rates={rates} displayCurrency="USD"
        onDisplayCurrencyChange={() => undefined} valueHistory={[]} rateError=""
        quoteStatus={{ loading: false, lastSyncedAt: null, error: '', summary: '' }}
        canRefreshQuotes={false} onRefreshQuotes={() => undefined} exposureTargetPct={120}
        {...quantProps}
      />,
    );

    expect(html).toContain('等效正股暴露（USD）');
    expect(html).toContain('目标 120%');
    expect(html).toContain('正股');
    expect(html).toContain('杠杆折算');
    expect(html).toContain('期权Δ');
    expect(html).toContain('网站口径：期权按 Delta 折算');
    expect(html).toContain('1 个期权缺 Delta/标的价未计入');
  });

  it('explains the Pages limitation and renders stale quant timestamps without hiding prior data', () => {
    const metrics = computeMetrics({ holdings: [], cash: [], updatedAt: 'old' }, rates);
    const pagesHtml = renderToStaticMarkup(
      <Summary
        metrics={metrics} rates={rates} displayCurrency="USD"
        onDisplayCurrencyChange={() => undefined} valueHistory={[]} rateError=""
        quoteStatus={{ loading: false, lastSyncedAt: null, error: '', summary: '' }}
        canRefreshQuotes={false} onRefreshQuotes={() => undefined} exposureTargetPct={100}
        {...quantProps}
      />,
    );
    const staleHtml = renderToStaticMarkup(
      <Summary
        metrics={metrics} rates={rates} displayCurrency="USD"
        onDisplayCurrencyChange={() => undefined} valueHistory={[]} rateError=""
        quoteStatus={{ loading: false, lastSyncedAt: null, error: '', summary: '' }}
        canRefreshQuotes={false} onRefreshQuotes={() => undefined} exposureTargetPct={100}
        {...quantProps}
        quantSyncEnabled
        quantGatewayAvailable
        quantTokenConfigured
        quantStatus={{ loading: false, asOf: '2026-07-15', pushedAt: '2026-07-15T00:00:00.000Z', stale: true, error: '', summary: '已同步' }}
      />,
    );

    expect(pagesHtml).toContain('量化同步仅在 VPS 入口可用');
    expect(pagesHtml).toContain('一键刷新仅在 VPS 入口可用');
    expect(pagesHtml).toContain('disabled');
    expect(staleHtml).toContain('数据截至 2026-07-15（IBKR 快照日）');
    expect(staleHtml).toContain('数据陈旧');
  });

  it('shows the unified refresh progress, cooldown, and push explanation', () => {
    const metrics = computeMetrics({ holdings: [], cash: [], updatedAt: 'old' }, rates);
    const html = renderToStaticMarkup(
      <Summary
        metrics={metrics} rates={rates} displayCurrency="USD"
        onDisplayCurrencyChange={() => undefined} valueHistory={[]} rateError=""
        quoteStatus={{ loading: false, lastSyncedAt: null, error: '', summary: '' }}
        canRefreshQuotes={false} onRefreshQuotes={() => undefined} exposureTargetPct={100}
        {...quantProps}
        quantGatewayAvailable
        quantSyncEnabled
        quantTokenConfigured
        oneTapRefreshState={{ phase: 'waiting', message: '正在计算（约 1 分钟）…' }}
        oneTapCooldownSeconds={42}
      />,
    );

    expect(html).toContain('一键刷新全部');
    expect(html).toContain('正在计算（约 1 分钟）…');
    expect(html).toContain('42 秒后可再次刷新');
    expect(html).toContain('刷新会让量化系统重新检查一次，若有符合条件的标的会照常推送到手机');
  });

  it('describes the 35-minute regular-session quote schedule', () => {
    const metrics = computeMetrics({ holdings: [], cash: [], updatedAt: 'old' }, rates);
    const html = renderToStaticMarkup(
      <Summary
        metrics={metrics} rates={rates} displayCurrency="USD"
        onDisplayCurrencyChange={() => undefined} valueHistory={[]} rateError=""
        quoteStatus={{ loading: false, lastSyncedAt: null, error: '', summary: '' }}
        dayChangeStatusText="盘中"
        canRefreshQuotes onRefreshQuotes={() => undefined} exposureTargetPct={100}
        {...quantProps}
      />,
    );
    expect(html).toContain('美股盘中每 35 分钟自动刷新');
  });
});
