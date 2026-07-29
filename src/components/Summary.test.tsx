import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../metrics';
import type { ExchangeRates, QuantAnalysisSnapshot } from '../types';
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
  it('renders server risk, ammunition, sleeve, option, and dip data without inventing a buy amount', () => {
    const metrics = computeMetrics({ holdings: [], cash: [], updatedAt: 'old' }, rates);
    const snapshot = {
      source: 'futu-assistant', generated_at: '2026-07-28T12:00:00Z', rule_version: 'test', disclaimer: 'test', context: {}, symbols: {},
      ammo_overview: {
        buying_power: { by_underlying_usd: 0, by_2x_usd: 0, by_3x_usd: 0, binding_constraint: 'exposure_cap', headline: '按当前敞口上限，暂无新增买入空间（有钱但没额度——杠杆已占满敞口）' },
        top_consumers: [{ symbol: 'TQQQ', effective_usd: 59_286, pct_of_nav: 42.3 }],
      },
      max_loss: { total_usd: 43_000, pct_of_nav: 30.7 },
      option_exposure: { premium_usd: 13_519, premium_pct_of_nav: 9.6, premium_cap_pct: 5, over_limit: true, delta_exposure_usd: 71_000, items: [{ symbol: 'MSFT', delta: 0.5, delta_source: 'estimated', delta_notional_usd: 20_000, days_to_expiry: 18, status: 'critical' }] },
      sleeve_status: { tech: { pct: 87.1, target_pct: 65, deviation_pp: 22.1 }, options: { pct: 9.6, target_pct: 5, deviation_pp: 4.6 }, broad_dow: { pct: 0.6, target_pct: 30, deviation_pp: -29.4 } },
      allocation_plan: { total_available_usd: 0, by_sleeve: [{ sleeve: 'broad_dow', priority: 1, suggested_usd: 0, candidates: [{ symbol: 'UPRO' }] }] },
      dip_status: { SOXL: { companion_text: '不必猜最低点。还有 2 批。', ammo: { remaining_usd: 8_400, account_gate: { allowed_usd: 0 } } } },
    } as unknown as QuantAnalysisSnapshot;
    const html = renderToStaticMarkup(
      <Summary
        metrics={metrics} rates={rates} displayCurrency="USD" onDisplayCurrencyChange={() => undefined}
        valueHistory={[]} rateError="" quoteStatus={{ loading: false, lastSyncedAt: null, error: '', summary: '' }}
        canRefreshQuotes={false} onRefreshQuotes={() => undefined} exposureTargetPct={100}
        analysisSnapshot={snapshot} {...quantProps}
      />,
    );
    expect(html).toContain('等效敞口');
    expect(html).toContain('最大可损');
    expect(html).toContain('有钱但没额度——杠杆已占满敞口');
    expect(html).toContain('65/5/30');
    expect(html).toContain('期权风险专区');
    expect(html).toContain('不必猜最低点');
    expect(html).not.toContain('可以买入');
  });

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

  it('puts the two decision metrics before the secondary refresh control in a single-column mobile layout', () => {
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
        {...quantProps}
      />,
    );

    expect(html).toContain('grid-cols-1');
    expect(html).toContain('md:grid-cols-4');
    expect(html).toContain('md:col-span-2');
    expect(html).toContain('text-4xl');
    expect(html.indexOf('总资产（USD）')).toBeLessThan(html.indexOf('一键刷新全部'));
    expect(html.indexOf('今日涨跌（USD）')).toBeLessThan(html.indexOf('一键刷新全部'));
  });
});
