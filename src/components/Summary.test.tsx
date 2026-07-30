import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../metrics';
import type { ExchangeRates, QuantAnalysisSnapshot } from '../types';
import { SleeveBar, Summary } from './Summary';

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
  it('explains that equity value includes cash-equivalent ETFs', () => {
    const metrics = computeMetrics({
      holdings: [{
        id: 'sgov', symbol: 'SGOV', name: 'SGOV', shares: 100, buyPrice: 100,
        currentPrice: 100, sector: '现金', currency: 'USD', assetType: 'etf', cashEquivalent: true,
      }],
      cash: [{ currency: 'USD', amount: 5_000 }],
      updatedAt: '2026-07-30',
    }, rates);
    const html = renderToStaticMarkup(
      <Summary
        metrics={metrics} rates={rates} displayCurrency="USD" onDisplayCurrencyChange={() => undefined}
        valueHistory={[]} rateError="" quoteStatus={{ loading: false, lastSyncedAt: null, error: '', summary: '' }}
        canRefreshQuotes={false} onRefreshQuotes={() => undefined} exposureTargetPct={100}
        {...quantProps}
      />,
    );

    expect(html).toContain('含现金类 ETF $10,000.00');
  });

  it('keeps a single-basis sleeve card strictly on that server-provided basis', () => {
    const html = renderToStaticMarkup(
      <SleeveBar
        name="tech"
        displayBasis="cash"
        row={{
          baseline_pct: 65,
          hard_cap_pct: 75,
          note: '双口径总说明：等效已超硬顶',
          effective: { pct: 91.26, zone: 'over_hard_cap', available_target_pct: 75, note: '等效说明：已超硬顶' },
          cash: { pct: 54.03, zone: 'under', available_target_pct: 65, note: '现金说明：仍在基准内' },
        }}
      />,
    );

    expect(html).toContain('现金 54.03%');
    expect(html).toContain('现金说明：仍在基准内');
    expect(html).toContain('现金目标 65%');
    expect(html).not.toContain('等效 91.26%');
    expect(html).not.toContain('等效说明：已超硬顶');
    expect(html).not.toContain('双口径总说明：等效已超硬顶');
    expect(html).not.toContain('等效目标 75%');
    expect(html).toContain('flex-col');
    expect(html).toContain('sm:flex-row');
    expect(html).toContain('min-w-0');
  });

  it('renders a solid loss track and a distinct beyond-hard-cap segment for the selected basis', () => {
    const html = renderToStaticMarkup(
      <SleeveBar
        name="options"
        displayBasis="cash"
        row={{
          baseline_pct: 5,
          hard_cap_pct: 5,
          cash: { pct: 9.58, zone: 'over_hard_cap', note: '现金超硬顶' },
          effective: { pct: 104.94, zone: 'over_hard_cap', note: '等效超硬顶' },
        }}
      />,
    );

    expect(html).toContain('现金 9.58%');
    expect(html).toContain('超硬顶(现金)');
    expect(html).toContain('bg-loss');
    expect(html).toContain('sleeve-over-hard-cap');
    expect(html).not.toContain('等效 104.94%');
  });

  it('renders only the selected metric target and marker in a single-basis sleeve card', () => {
    const row = {
      baseline_pct: 25,
      hard_cap_pct: 30,
      effective: { pct: 0.71, zone: 'under', available_target_pct: 15 },
      cash: { pct: 0.24, zone: 'under', available_target_pct: 25 },
    };
    const effectiveHtml = renderToStaticMarkup(<SleeveBar name="broad_dow" displayBasis="effective" row={row} />);
    const cashHtml = renderToStaticMarkup(<SleeveBar name="broad_dow" displayBasis="cash" row={row} />);

    expect(effectiveHtml).toContain('等效目标 15%');
    expect(effectiveHtml).toContain('data-sleeve-target="effective"');
    expect(effectiveHtml).not.toContain('基准 25%');
    expect(effectiveHtml).not.toContain('硬顶 30%');
    expect(effectiveHtml).not.toContain('data-sleeve-target="cash"');

    expect(cashHtml).toContain('现金目标 25%');
    expect(cashHtml).toContain('data-sleeve-target="cash"');
    expect(cashHtml).not.toContain('基准 25%');
    expect(cashHtml).not.toContain('硬顶 30%');
    expect(cashHtml).not.toContain('data-sleeve-target="effective"');
  });

  it('renders server risk, ammunition, sleeve, option, and dip data without inventing a buy amount', () => {
    const metrics = computeMetrics({ holdings: [], cash: [], updatedAt: 'old' }, rates);
    const snapshot = {
      source: 'futu-assistant', generated_at: '2026-07-28T12:00:00Z', rule_version: 'test', disclaimer: 'test', context: {}, symbols: {},
      ammo_overview: {
        exposure: { effective_usd: 281_365, effective_pct: 200.84 },
        cash_exposure: { invested_usd: 95_050, invested_pct: 67.85, available_usd: 28_708, basis: 'cash' },
        buying_power: { by_underlying_usd: 0, by_2x_usd: 0, by_3x_usd: 0, binding_constraint: 'exposure_cap', headline: '按当前敞口上限，暂无新增买入空间（有钱但没额度——杠杆已占满敞口）' },
        top_consumers: [{ symbol: 'TQQQ', effective_usd: 59_286, pct_of_nav: 42.3 }],
      },
      max_loss: { total_usd: 43_000, pct_of_nav: 30.7 },
      option_exposure: { premium_usd: 13_519, premium_pct_of_nav: 9.6, premium_cap_pct: 5, over_limit: true, delta_exposure_usd: 71_000, items: [{ symbol: 'MSFT', delta: 0.5, delta_source: 'estimated', delta_notional_usd: 20_000, days_to_expiry: 18, status: 'critical' }] },
      sleeve_status: {
        tech: { baseline_pct: 65, hard_cap_pct: 75, borrowed_pp: 10, borrow_room_pp: 0, block_new_buy: true, effective: { pct: 91.22, zone: 'over_hard_cap', over_baseline_usd: 36_757.77, over_hard_cap_usd: 22_724, gap_usd: 0 }, cash: { pct: 54.03, zone: 'under', over_baseline_usd: 0, over_hard_cap_usd: 0, gap_usd: 15_353.33 } },
        options: { baseline_pct: 5, hard_cap_pct: 5, block_new_buy: true, effective: { pct: 104.92, zone: 'over_hard_cap' }, cash: { pct: 9.58, zone: 'over_hard_cap' } },
        broad_dow: { baseline_pct: 25, lent_pp: 10, available_target_pct: 15, effective: { pct: 0.71, zone: 'empty', available_target_pct: 15 }, cash: { pct: 0.24, zone: 'empty', available_target_pct: 25 } },
      },
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
    expect(html).toContain('实付现金');
    expect(html).toContain('最大可损');
    expect(html).toContain('有钱但没额度——杠杆已占满敞口');
    expect(html).toContain('65/5/25/5');
    expect(html).toContain('等效 91.22%');
    expect(html).toContain('现金 54.03%');
    expect(html).toContain('双显');
    expect(html).toContain('硬顶 75.00%');
    expect(html).toContain('超基准 $36,758');
    expect(html).toContain('禁区，不可借');
    expect(html).toContain('已被科技借走 10.00pp');
    expect(html).toContain('现金目标 25%');
    expect(html).toContain('期权风险专区');
    expect(html).toContain('不必猜最低点');
    expect(html).not.toContain('可以买入');
  });

  it('keeps cash allocation on its server-provided invested-cash denominator and hides allocation sentinel priorities', () => {
    const metrics = computeMetrics({ holdings: [], cash: [], updatedAt: 'old' }, rates);
    const snapshot = {
      source: 'futu-assistant', generated_at: '2026-07-30T12:00:00Z', rule_version: '2.7', disclaimer: 'test', context: {}, symbols: {},
      ammo_overview: {
        exposure: { effective_usd: 276_000, effective_pct: 200.91 },
        cash_exposure: { invested_usd: 95_011, invested_pct: 100, available_usd: 28_708, basis: 'invested_cash', denominator_usd: 95_011 },
      },
      option_exposure: { delta_exposure_usd: 146_970.5, items: [{ symbol: 'MSFT', delta: 0.5, delta_source: 'estimated', delta_notional_usd: 20_000 }] },
      sleeve_status: {
        tech: {
          baseline_pct: 65, hard_cap_pct: 75, block_new_buy: true,
          note: '已用满 10.0pp 借额（上限 75%），仍超硬顶 22,771，不建议新增科技',
          effective: { pct: 91.26, zone: 'over_hard_cap', over_hard_cap_usd: 22_771, gap_usd: 0, denominator_usd: 137_392 },
          cash: { pct: 79.63, zone: 'over_hard_cap', over_hard_cap_usd: 4_400, gap_usd: 0, denominator_usd: 95_011 },
        },
        options: {
          baseline_pct: 5, hard_cap_pct: 5, block_new_buy: true,
          effective: { pct: 104.94, zone: 'over_hard_cap', gap_usd: 0 },
          cash: { pct: 14.12, zone: 'over_hard_cap', gap_usd: 0 },
        },
        broad_dow: { baseline_pct: 25, effective: { pct: 0.71, zone: 'under' }, cash: { pct: 0.35, zone: 'under' } },
      },
      allocation_plan: {
        total_available_usd: 0,
        by_sleeve: [
          { sleeve: 'broad_dow', priority: 1, underweight_pp: -24.29, suggested_usd: 0, candidates: [{ symbol: 'UPRO' }] },
          { sleeve: 'tech', priority: 99, blocked: true, block_reason: '已超目标配比，新增弹药不投向科技', suggested_usd: 0 },
          { sleeve: 'other', priority: 99, suggested_usd: 0 },
        ],
      },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(
      <Summary
        metrics={metrics} rates={rates} displayCurrency="USD" onDisplayCurrencyChange={() => undefined}
        valueHistory={[]} rateError="" quoteStatus={{ loading: false, lastSyncedAt: null, error: '', summary: '' }}
        canRefreshQuotes={false} onRefreshQuotes={() => undefined} exposureTargetPct={100}
        analysisSnapshot={snapshot} {...quantProps}
      />,
    );

    expect(html).toContain('现金分母：已投现金合计 $95,011');
    expect(html).toContain('超硬顶(双)');
    expect(html).toContain('不建议新增科技');
    expect(html).toContain('当前无可分配弹药（闸门放行 $0）');
    expect(html).toContain('待补：宽基+道指（低配 24.29pp；总额度为 0，并非不应补）');
    expect(html).toContain('已超目标配比，新增弹药不投向科技');
    expect(html).toContain('不投：其他 —— 后端闸门未放行');
    expect(html).toContain('Delta 为统一假设 0.5，不是网站真实 Delta 口径');
    expect(html).not.toContain('优先 99');
    expect(html).not.toContain('缺口 $0');
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
    expect(html).toContain('网站口径：仅真实 Delta');
    expect(html).toContain('1 个期权缺 Delta/标的价未计入');
  });

  it('labels the real-Delta and assumed-Delta exposures as different bases', () => {
    const metrics = computeMetrics({
      holdings: [{
        id: 'igv', symbol: 'IGV', name: 'IGV CALL', shares: 1, buyPrice: 10, currentPrice: 10,
        sector: '科技', currency: 'USD', assetType: 'option',
        option: { underlying: 'IGV', optionType: 'call', strike: 80, expiration: '2027-01-15', contractMultiplier: 100, delta: null, theta: null, gamma: null, vega: null, impliedVolatility: null, underlyingPrice: 95 },
      }],
      cash: [], updatedAt: 'old',
    }, rates);
    const snapshot = {
      source: 'futu-assistant', generated_at: '2026-07-30', rule_version: 'test', disclaimer: '', context: {}, symbols: {},
      option_exposure: { delta_exposure_usd: 15_000, items: [{ symbol: 'IGV', delta: 0.5, delta_source: 'estimated', delta_notional_usd: 15_000 }] },
    } as unknown as QuantAnalysisSnapshot;
    const html = renderToStaticMarkup(
      <Summary
        metrics={metrics} rates={rates} displayCurrency="USD" onDisplayCurrencyChange={() => undefined}
        valueHistory={[]} rateError="" quoteStatus={{ loading: false, lastSyncedAt: null, error: '', summary: '' }}
        canRefreshQuotes={false} onRefreshQuotes={() => undefined} exposureTargetPct={100}
        analysisSnapshot={snapshot} {...quantProps}
      />,
    );

    expect(html).toContain('仅真实 Delta');
    expect(html).toContain('下方期权风险专区的 0.5 假设口径');
    expect(html).toContain('统一假设 0.5，不是网站真实 Delta 口径');
  });

  it('omits the tautological invested-cash percentage from its denominator label', () => {
    const metrics = computeMetrics({ holdings: [], cash: [], updatedAt: 'old' }, rates);
    const snapshot = {
      source: 'futu-assistant', generated_at: '2026-07-30', rule_version: 'test',
      disclaimer: '', context: {}, symbols: {},
      ammo_overview: {
        cash_exposure: { invested_usd: 93_827.72, invested_pct: 100, denominator_usd: 93_827.72 },
      },
    } as unknown as QuantAnalysisSnapshot;
    const html = renderToStaticMarkup(
      <Summary
        metrics={metrics} rates={rates} displayCurrency="USD" onDisplayCurrencyChange={() => undefined}
        valueHistory={[]} rateError="" quoteStatus={{ loading: false, lastSyncedAt: null, error: '', summary: '' }}
        canRefreshQuotes={false} onRefreshQuotes={() => undefined} exposureTargetPct={100}
        analysisSnapshot={snapshot} {...quantProps}
      />,
    );

    expect(html).toContain('现金分母：已投现金合计 $93,827.72');
    expect(html).not.toContain('$93,827.72 · 100.00%');
  });

  it('does not repeat the one-tap refresh button label as the card title', () => {
    const metrics = computeMetrics({ holdings: [], cash: [], updatedAt: 'old' }, rates);
    const html = renderToStaticMarkup(
      <Summary
        metrics={metrics} rates={rates} displayCurrency="USD" onDisplayCurrencyChange={() => undefined}
        valueHistory={[]} rateError="" quoteStatus={{ loading: false, lastSyncedAt: null, error: '', summary: '' }}
        canRefreshQuotes={false} onRefreshQuotes={() => undefined} exposureTargetPct={100}
        {...quantProps}
      />,
    );

    expect(html.match(/一键刷新全部/g)).toHaveLength(1);
    expect(html).toContain('>刷新<');
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

    expect(html).toContain('>刷新<');
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
