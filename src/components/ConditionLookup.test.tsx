import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { quantAnalysisFixture } from '../testFixtures/quantAnalysis';
import type { QuantAnalysisSnapshot } from '../types';
import { ConditionLookup } from './ConditionLookup';

const holdings = [
  { id: 'msft', symbol: 'MSFT', name: '微软', shares: 10, buyPrice: 300, currentPrice: 400, sector: '科技', currency: 'USD' as const, assetType: 'stock' as const, broker: 'IBKR' },
  { id: 'msfu-option', symbol: 'MSFU CALL', name: 'MSFU Call', shares: 2, buyPrice: 2, currentPrice: 3, sector: '科技', currency: 'USD' as const, assetType: 'option' as const, broker: 'FUTU', option: { underlying: 'MSFU', optionType: 'call' as const, strike: 30, expiration: '2027-01-15', contractMultiplier: 100, delta: 0.4, theta: null, gamma: null, vega: null, impliedVolatility: null, underlyingPrice: 25 } },
  { id: 'tqqq', symbol: 'TQQQ', name: 'TQQQ', shares: 10, buyPrice: 50, currentPrice: 60, sector: 'ETF', currency: 'USD' as const, assetType: 'leveraged_etf' as const, broker: 'LONGPORT' },
  { id: 'sgov', symbol: 'SGOV', name: '现金类', shares: 10, buyPrice: 100, currentPrice: 100, sector: '现金', currency: 'USD' as const, assetType: 'etf' as const, broker: 'IBKR', cashEquivalent: true },
];

afterEach(() => vi.useRealTimers());

describe('ConditionLookup', () => {
  it('states that the loaded snapshot refreshes automatically every 25 minutes', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).toContain('每 25 分钟自动更新');
  });

  it('uses a locked snapshot-symbol select and filters cash equivalents', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).toContain('<select');
    expect(html).toContain('value="AAPL"');
    expect(html).toContain('value="SOXL"');
    expect(html).not.toContain('value="SGOV"');
    expect(html).not.toContain('placeholder="例如 SOXL"');
    expect(html).not.toContain('>查询</button>');
  });

  it('adds server-summary status dots to both existing selectors', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} holdings={holdings} initialSymbol="SOXL" />,
    );

    expect(html).toContain('🟢 SOXL · 可买');
    expect(html).toContain('🟡 AMZN · 接近');
    expect(html).toContain('⚪ MSFT · 市值 $4000.00 · IBKR · 观察期</option>');
    expect(html).not.toContain('🟠 MSFT');
    expect(html).toContain('⚪ AAPL · 无');
  });

  it('shows successful refresh feedback with the snapshot timestamp and minute age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T14:12:59.000Z'));

    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} onRefresh={() => undefined} />,
    );

    expect(html).toContain('快照 2026-07-15 10:00 ET，12 分钟前');
  });

  it('removes the production signal row while keeping the 3x depth and macro conditions', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).toContain('市场条件满足 1/2');
    expect(html).toContain('低位区');
    expect(html).not.toContain('买入信号');
    expect(html).toContain('估值/情绪');
    expect(html).not.toContain('当日熔断');
  });

  it('renders the server-authored panic status above an applicable 3x symbol card', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html.indexOf('恐慌抢买窗口')).toBeLessThan(html.indexOf('SOXL 买入条件'));
    expect(html).toContain('疯狂提醒中');
    expect(html).toContain('深度位 ✓');
    expect(html).toContain('恐慌位 ✓');
    expect(html).toContain('目标 20% / 当前 3.2%');
    expect(html).toContain('value="16"');
  });

  it('does not render a panic status for a symbol absent from the backend block', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="AAPL" />,
    );

    expect(html).not.toContain('恐慌抢买窗口');
  });

  it('renders stock own-depth first and removes CNN SOXX and NDX from its card', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="AAPL" />,
    );

    expect(html).toContain('深度买入窗口（个股）');
    expect(html).toContain('深度位 ✓');
    expect(html).toContain('当前回撤</span><strong class="text-2xl">22.50%');
    expect(html).toContain('阈值</span><strong class="text-2xl">21.70%');
    expect(html).toContain('60 日胜率 68.00%');
    expect(html).toContain('（n=25）');
    expect(html).toContain('个股 PE 分位 45.00%');
    expect(html).not.toContain('CNN 29.00');
    expect(html).not.toContain('SOXX');
    expect(html).not.toContain('纳指100');
  });

  it('expands the valuation position card by default', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="AAPL" />,
    );

    expect(html).toContain('估值位置（参考，不参与开窗）');
    expect(html).not.toContain('<summary class="cursor-pointer font-semibold">参考信息（不参与开窗）</summary>');
  });

  it('renders a low 20.40-percent PE percentile as green with an honest interpretation', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.symbols.AAPL.gates!.valuation.stock_percentile = 20.4;

    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={snapshot} initialSymbol="AAPL" />,
    );

    expect(html).toContain('aria-label="个股 PE 分位"');
    expect(html).toContain('aria-valuenow="20.4"');
    expect(html).toContain('data-zone="low"');
    expect(html).toContain('bg-emerald-600');
    expect(html).toContain('分位 20.40% = 当前 PE 低于过去约 80% 的时间');
  });

  it('renders an 85-percent PE percentile as a red historical-high position', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.symbols.AAPL.gates!.valuation.stock_percentile = 85;

    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={snapshot} initialSymbol="AAPL" />,
    );

    expect(html).toContain('data-zone="high"');
    expect(html).toContain('bg-rose-600');
    expect(html).toContain('分位 85.00% = 当前 PE 低于过去约 15% 的时间');
  });

  it('shows unavailable valuation data without drawing a fake percentile bar', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.symbols.AAPL.gates!.valuation.stock_percentile = null;

    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={snapshot} initialSymbol="AAPL" />,
    );

    expect(html).toContain('个股 PE 分位');
    expect(html).toContain('暂无');
    expect(html).not.toContain('role="meter"');
  });

  it('renders backend-authored ready and near depth highlights without recomputing thresholds', () => {
    const ready = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="AAPL" />,
    );
    const near = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="AMZN" />,
    );

    expect(ready).toContain('✓ 已达标');
    expect(ready).toContain('当前回撤</span><strong class="text-2xl">22.50%');
    expect(ready).toContain('阈值</span><strong class="text-2xl">21.70%');
    expect(ready).toContain('value="100"');
    expect(ready).toContain('60 日胜率 68.00%');
    expect(near).toContain('接近 · 还差 2.30 点');
    expect(near).toContain('value="86.857143"');
  });

  it('shows derived depth prices with approximation marks and the exact source warning', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.symbols.AAPL.depth_window = {
      ...snapshot.symbols.AAPL.depth_window!,
      current_pct: -21.8,
      threshold_pct: -16.24,
      price_session: 'overnight',
    };
    const quotedHoldings = [{
      ...holdings[0],
      id: 'aapl',
      symbol: 'AAPL',
      quote: {
        symbol: 'AAPL',
        price: 384.98,
        previousClose: 380,
        change: 4.98,
        changePercent: 0.0131,
        currency: 'USD' as const,
        timestamp: '2026-07-22T08:00:00.000Z',
        source: 'proxy' as const,
      },
    }];

    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={snapshot} holdings={quotedHoldings} initialSymbol="AAPL" />,
    );

    expect(html).toContain('现价 $384.98');
    expect(html).toContain('高点 ~$492.30');
    expect(html).toContain('阈值价 ~$412.35');
    expect(html).toContain('价格由行情代理现价与量化回撤反推，与量化取价时段（夜盘）可能有偏差');
  });

  it('uses quant-exported depth prices without approximation marks or a warning', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.symbols.AAPL.depth_window = {
      ...snapshot.symbols.AAPL.depth_window!,
      current_price: 380,
      high_price: 490,
      threshold_price: 410,
      next_level_price: 400,
    };

    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={snapshot} initialSymbol="AAPL" />,
    );

    expect(html).toContain('现价 $380.00');
    expect(html).toContain('高点 $490.00');
    expect(html).toContain('阈值价 $410.00');
    expect(html).not.toContain('高点 ~$490.00');
    expect(html).not.toContain('价格由行情代理现价与量化回撤反推');
  });

  it('keeps the percentage-only card when neither quant nor quote prices exist', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="AAPL" />,
    );

    expect(html).toContain('当前回撤');
    expect(html).toContain('阈值');
    expect(html).not.toContain('现价 $');
    expect(html).not.toContain('NaN');
  });

  it('renders far and insufficient states honestly in both themes', () => {
    const snapshot = {
      ...quantAnalysisFixture,
      summary: {
        ...quantAnalysisFixture.summary,
        depth_states: {
          ...quantAnalysisFixture.summary.depth_states,
          AMZN: { status: 'far' as const, gap_pct: 8, excess_pct: 0, progress_pct: 55.55 },
        },
      },
    };
    const far = renderToStaticMarkup(
      <ConditionLookup snapshot={snapshot} initialSymbol="AMZN" />,
    );
    const insufficient = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(far).toContain('未达标');
    expect(far).toContain('value="55.55"');
    expect(far).toContain('dark:');
    expect(insufficient).toContain('60 日样本不足（n=18）');
    expect(insufficient).toContain('text-slate-400');
    expect(insufficient).toContain('min-w-0');
    expect(insufficient).toContain('overflow-hidden');
  });

  it('highlights the panic result and names its trigger session', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).toContain('恐慌位 ✓ 已触发');
    expect(html).toContain('触发时段：盘中');
  });

  it('collapses position and batch into an integer-formatted discipline group', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).toContain('<details');
    expect(html).toContain('纪律闸门（决定允许买多少），不是行情判断');
    expect(html).toContain('第 2 批 / 共 3 批');
    expect(html).not.toContain('2.00');
    expect(html).not.toContain('3.00 批');
    expect(html).toContain('CNN 46.30');
    expect(html).toContain('纳指100 PE 分位 83.10%');
    expect(html).toContain('SOXX 分位 98.70%');
    expect(html).toContain('个股 PE 分位 暂无');
  });

  it('shows the exact snapshot age when quant data is stale', () => {
    const snapshot = {
      ...quantAnalysisFixture,
      generated_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    };
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={snapshot} initialSymbol="SOXL" />,
    );

    expect(html).toContain('量化分析数据 25 小时前，可能过期');
  });

  it('shows the mandatory warning instead of a win rate for samples below 20', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).toContain('5 日');
    expect(html).toContain('样本不足，勿下结论');
    expect(html).toContain('n=19');
    expect(html).toContain('20 日');
    expect(html).toContain('55.00%');
    expect(html).toContain('历史统计不代表未来收益');
  });

  it('shows the mandatory warning for an insufficient drawdown-depth sample', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).toContain('回撤深度 60%');
    expect(html).toContain('样本不足，勿下结论（n=10）');
    expect(html).toContain('含熊市样本：是');
  });

  it('shows the 60-day win rate for a conclusive drawdown-depth sample', () => {
    const snapshot = {
      ...quantAnalysisFixture,
      symbols: {
        ...quantAnalysisFixture.symbols,
        SOXL: {
          ...quantAnalysisFixture.symbols.SOXL,
          depth_stats: {
            level_pct: 60,
            win_rate_60d: 0.68,
            n: 25,
            sample_insufficient: false,
            bear_included: true,
          },
        },
      },
    };
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={snapshot} initialSymbol="SOXL" />,
    );

    expect(html).toContain('回撤深度 60%');
    expect(html).toContain('60 日历史成功率 68.00%（n=25）');
    expect(html).toContain('含熊市样本：是');
  });

  it('renders a held-only sell selector and the server-authored repair window', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} holdings={holdings} initialSymbol="AAPL" />,
    );

    expect(html).toContain('aria-label="卖出持仓标的"');
    expect(html).toContain('value="MSFT"');
    expect(html).toContain('value="MSFU"');
    expect(html).toContain('value="TQQQ"');
    expect(html).not.toContain('value="SGOV"');
    expect(html).toContain('卖出窗口未开启：深跌修复期内，耐心持有（基准日 2026-03-30）');
    expect(html).toContain('建议至少减仓 50%');
    expect(html).toContain('市场亢奋·清仓杠杆品种或调仓 SGOV');
    expect(html).toContain('止盈阶梯参考 · 剧本：个股');
    expect(html).toContain('（观察期，未正式生效）');
    expect(html).toContain('触发依据：知足常乐');
    expect(html).toContain('自基准日 +18.00% vs QQQ +20.00%');
    expect(html).toContain('该判定来自量化系统的相对强弱口径（自反弹基准日涨幅 vs QQQ），与你的买入成本无关；是否盈利请看下方「本族当前盈亏」。');
    expect(html).toContain('原始判定数据');
    expect(html).toContain('&quot;trigger&quot;: &quot;知足常乐&quot;');
    expect(html).toContain('&quot;detail&quot;: &quot;自基准日 +18.00% vs QQQ +20.00%&quot;');
    expect(html).toContain('&quot;shadow&quot;: true');
    expect(html).toContain('&quot;state&quot;: &quot;observation&quot;');
    expect(html).toContain('&quot;playbook_label&quot;: &quot;个股&quot;');
    expect(html).toContain('用于核对量化系统口径；若这里显示的族数与你的预期不符，请把本块内容反馈给量化系统维护方。');
    expect(html).toContain('5日涨幅过热 2026-07-15');
    expect(html).toContain('只提醒不下单；由你在券商 App 手动执行。');
  });

  it('shows the orange open-window label only for non-shadow evidence', () => {
    const snapshot = {
      ...quantAnalysisFixture,
      sell: {
        ...quantAnalysisFixture.sell,
        shadow: false,
      },
      summary: {
        ...quantAnalysisFixture.summary,
        sell_ready: quantAnalysisFixture.summary.sell_ready.map((item) => ({ ...item, shadow: false })),
      },
    };
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={snapshot} holdings={holdings} initialSymbol="MSFT" />,
    );

    expect(html).toContain('🟠 MSFT · 市值 $4000.00 · IBKR · 卖出窗口开启</option>');
    expect(html).not.toContain('MSFT · 市值 $4000.00 · IBKR · 观察期</option>');
  });

  it('explains module-level observation and never labels its signals as open windows', () => {
    const snapshot = {
      ...quantAnalysisFixture,
      summary: {
        ...quantAnalysisFixture.summary,
        sell_ready: quantAnalysisFixture.summary.sell_ready.map((item) => ({ ...item, shadow: false })),
      },
    };
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={snapshot} holdings={holdings} initialSymbol="MSFT" />,
    );

    expect(html).toContain('量化卖出模块当前为观察期，全部信号均未正式生效');
    expect(html).not.toContain('卖出窗口开启');
    expect(html).toContain('MSFT · 市值 $4000.00 · IBKR · 观察期</option>');
  });

  it('shows an explicit fallback when the quant playbook has no label', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.sell!.symbols.MSFT.playbook.label = undefined;
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={snapshot} holdings={holdings} initialSymbol="MSFT" />,
    );

    expect(html).toContain('止盈阶梯参考 · 剧本：未标注');
  });

  it('discloses when a held symbol belongs to multiple families and shows the largest one', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    const base = structuredClone(snapshot.sell!.symbols.MSFT);
    snapshot.sell!.symbols = {
      SMALL: { ...structuredClone(base), family: 'SMALL', market_value: 1_000, held_symbols: ['SHARED'] },
      LARGE: { ...structuredClone(base), family: 'LARGE', market_value: 5_000, held_symbols: ['SHARED'] },
    };
    snapshot.summary!.sell_ready = [{
      symbol: 'LARGE', trigger: '知足常乐', detail: '量化系统原始依据', shadow: true,
    }];
    const sharedHoldings = [{ ...holdings[0], id: 'shared', symbol: 'SHARED' }];
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={snapshot} holdings={sharedHoldings} initialSymbol="SHARED" />,
    );

    expect(html).toContain('该标的同时属于多个族，已按市值最大者展示');
    expect(html).toContain('&quot;family&quot;: &quot;LARGE&quot;');
  });

  it('shows family loss and disables profit-taking ladder emphasis', () => {
    const losingHoldings = [
      { ...holdings[0], shares: 10, buyPrice: 100, currentPrice: 80 },
    ];
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} holdings={losingHoldings} initialSymbol="MSFT" />,
    );

    expect(html).toContain('本族当前盈亏');
    expect(html).toContain('市值 $800.00');
    expect(html).toContain('成本 $1,000.00');
    expect(html).toContain('浮盈亏 -$200.00（-20.00%）');
    expect(html).toContain('当前为浮亏 −20.00%，止盈阶梯（最低档 +5.00%）尚未适用');
    expect(html).not.toContain('仅含已知成本部分');
    expect(html).not.toContain('止盈阶梯参考请以券商实际成本为准');
    expect(html).not.toContain('data-active="true"');
  });

  it('qualifies partial family pnl and lists option holdings with unknown costs', () => {
    const partialHoldings = [
      { ...holdings[0], shares: 10, buyPrice: 100, currentPrice: 80 },
      {
        id: 'msft-call-unknown', symbol: 'MSFT', name: 'MSFT Call',
        shares: 1, buyPrice: 0, currentPrice: 2, marketValueOverride: 200,
        sector: '科技', currency: 'USD' as const, assetType: 'option' as const,
        broker: 'FUTU',
        option: {
          underlying: 'MSFT', optionType: 'call' as const, strike: 500,
          expiration: '2028-01-21', contractMultiplier: 100,
          delta: 0.4, theta: null, gamma: null, vega: null,
          impliedVolatility: null, underlyingPrice: 400,
        },
      },
    ];
    const snapshot = {
      ...quantAnalysisFixture,
      holding_costs: {
        ...quantAnalysisFixture.holding_costs,
        MSFT: {
          weighted_average_cost: 100, currency: 'USD' as const,
          coverage: 'complete' as const, auto_fill_allowed: true,
        },
      },
    };
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={snapshot} holdings={partialHoldings} initialSymbol="MSFT" />,
    );

    expect(html).toContain('其中已计成本 $800.00 · 未计成本 $200.00');
    expect(html).toContain('基于已计成本部分 $800.00');
    expect(html).toContain('1 个持仓成本未知（期权成本需用「补充期权详情」导入），未计入本次盈亏：MSFT（期权）');
    expect(html).toContain('已知成本部分为浮亏 −20.00%（另有 1 个持仓成本未知）。止盈阶梯参考请以券商实际成本为准。');
    expect(html).not.toContain('当前为浮亏 −20.00%，止盈阶梯（最低档 +5.00%）尚未适用');
  });

  it('renders a reconcilable market-value split for partial family pnl', () => {
    const partialHoldings = [
      { ...holdings[0], shares: 10, buyPrice: 100, currentPrice: 80 },
      {
        id: 'msft-call-uncosted', symbol: 'MSFT', name: 'MSFT Call',
        shares: 1, buyPrice: 0, currentPrice: 2, marketValueOverride: 200,
        sector: '科技', currency: 'USD' as const, assetType: 'option' as const,
        option: {
          underlying: 'MSFT', optionType: 'call' as const, strike: 500,
          expiration: '2028-01-21', contractMultiplier: 100,
          delta: 0.4, theta: null, gamma: null, vega: null,
          impliedVolatility: null, underlyingPrice: 400,
        },
      },
    ];
    const snapshot = {
      ...quantAnalysisFixture,
      holding_costs: {
        ...quantAnalysisFixture.holding_costs,
        MSFT: {
          weighted_average_cost: 100, currency: 'USD' as const,
          coverage: 'complete' as const, auto_fill_allowed: true,
        },
      },
    };
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={snapshot} holdings={partialHoldings} initialSymbol="MSFT" />,
    );

    expect(html).toContain('市值 $1,000.00');
    expect(html).toContain('其中已计成本 $800.00 · 未计成本 $200.00');
    expect(html).toContain('浮盈亏 -$200.00（-20.00% · 基于已计成本部分 $800.00）');
  });

  it('highlights the matching profit ladder band for a profitable family', () => {
    const snapshot = {
      ...quantAnalysisFixture,
      sell: {
        ...quantAnalysisFixture.sell,
        symbols: {
          ...quantAnalysisFixture.sell.symbols,
          MSFT: {
            ...quantAnalysisFixture.sell.symbols.MSFT,
            playbook: {
              ...quantAnalysisFixture.sell.symbols.MSFT.playbook,
              sell_steps: [
                { gain_min_pct: 10, gain_max_pct: 20, sell_position_pct: 2 },
                { gain_min_pct: 20, gain_max_pct: 30, sell_position_pct: 3 },
                { gain_min_pct: 30, gain_max_pct: 999, sell_position_pct: 4 },
              ],
            },
          },
        },
      },
    };
    const profitableHoldings = [{ ...holdings[0], shares: 10, buyPrice: 100, currentPrice: 125 }];
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={snapshot} holdings={profitableHoldings} initialSymbol="MSFT" />,
    );

    expect(html).toContain('浮盈亏 $250.00（+25.00%）');
    expect(html).toContain('data-active="true"');
    expect(html).toContain('盈利 20.00%–30.00%：减总仓 3.00%');
  });

  it('qualifies an active profit tier when family cost coverage is partial', () => {
    const partialGainHoldings = [
      { ...holdings[0], shares: 10, buyPrice: 100, currentPrice: 125 },
      {
        id: 'msft-call-partial-gain', symbol: 'MSFT', name: 'MSFT Call',
        shares: 1, buyPrice: 0, currentPrice: 2, marketValueOverride: 200,
        sector: '科技', currency: 'USD' as const, assetType: 'option' as const,
      },
    ];
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} holdings={partialGainHoldings} initialSymbol="MSFT" />,
    );

    expect(html).toContain('data-active="true"');
    expect(html).toContain('该档位基于已计成本部分（另有 1 个持仓成本未知），实际盈利可能不同；减仓比例请以券商实际成本为准。');
  });

  it('does not qualify an active profit tier when family cost coverage is complete', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup
        snapshot={quantAnalysisFixture}
        holdings={[{ ...holdings[0], shares: 10, buyPrice: 100, currentPrice: 110 }]}
        initialSymbol="MSFT"
      />,
    );

    expect(html).toContain('data-active="true"');
    expect(html).not.toContain('该档位基于已计成本部分');
  });

  it('qualifies the distance to the first tier when partial known-cost pnl is below it', () => {
    const partialBelowFirstHoldings = [
      { ...holdings[0], shares: 10, buyPrice: 100, currentPrice: 102 },
      {
        id: 'msft-call-partial-below', symbol: 'MSFT', name: 'MSFT Call',
        shares: 1, buyPrice: 0, currentPrice: 2, marketValueOverride: 200,
        sector: '科技', currency: 'USD' as const, assetType: 'option' as const,
      },
    ];
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} holdings={partialBelowFirstHoldings} initialSymbol="MSFT" />,
    );

    expect(html).toContain('距第一档 +5.00% 还差 3.00 点（基于已计成本部分）');
  });

  it('shows only market value and unknown cost when family costs are unavailable', () => {
    const missingCostHoldings = [{ ...holdings[0], shares: 10, buyPrice: 0, currentPrice: 80 }];
    const snapshot = { ...quantAnalysisFixture, holding_costs: {} };
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={snapshot} holdings={missingCostHoldings} initialSymbol="MSFT" />,
    );

    expect(html).toContain('市值 $800.00');
    expect(html).toContain('成本未知');
    expect(html).not.toContain('浮盈亏');
    expect(html).not.toMatch(/成本未知[^<]*%/);
  });

  it('tells users to fill the holdings table when only non-option costs are unknown', () => {
    const snapshot = { ...quantAnalysisFixture, holding_costs: {} };
    const html = renderToStaticMarkup(
      <ConditionLookup
        snapshot={snapshot}
        holdings={[{ ...holdings[0], buyPrice: 0 }]}
        initialSymbol="MSFT"
      />,
    );

    expect(html).toContain('请在持仓表补填买入价');
    expect(html).not.toContain('期权成本需用「补充期权详情」导入');
  });

  it('shows both cost instructions when option and non-option costs are unknown', () => {
    const snapshot = { ...quantAnalysisFixture, holding_costs: {} };
    const html = renderToStaticMarkup(
      <ConditionLookup
        snapshot={snapshot}
        holdings={[
          { ...holdings[0], id: 'msft-stock-unknown', buyPrice: 0 },
          {
            ...holdings[0], id: 'msft-option-unknown', name: 'MSFT Call',
            buyPrice: 0, currentPrice: 2, marketValueOverride: 200,
            assetType: 'option' as const,
          },
        ]}
        initialSymbol="MSFT"
      />,
    );

    expect(html).toContain('期权成本需用「补充期权详情」导入');
    expect(html).toContain('请在持仓表补填买入价');
  });

});
