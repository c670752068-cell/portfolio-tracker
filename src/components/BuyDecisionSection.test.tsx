import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { depthQuotePrice } from '../depthQuotePrice';
import { quantAnalysisFixture } from '../testFixtures/quantAnalysis';
import type { QuantAnalysisSnapshot } from '../types';
import { BuyDecisionSection } from './BuyDecisionSection';

const holdings = [
  { id: 'msft', symbol: 'MSFT', name: '微软', shares: 10, buyPrice: 300, currentPrice: 400, sector: '科技', currency: 'USD' as const, assetType: 'stock' as const, broker: 'IBKR' },
  { id: 'msfu-option', symbol: 'MSFU CALL', name: 'MSFU Call', shares: 2, buyPrice: 2, currentPrice: 3, sector: '科技', currency: 'USD' as const, assetType: 'option' as const, broker: 'FUTU', option: { underlying: 'MSFU', optionType: 'call' as const, strike: 30, expiration: '2027-01-15', contractMultiplier: 100, delta: 0.4, theta: null, gamma: null, vega: null, impliedVolatility: null, underlyingPrice: 25 } },
  { id: 'tqqq', symbol: 'TQQQ', name: 'TQQQ', shares: 10, buyPrice: 50, currentPrice: 60, sector: 'ETF', currency: 'USD' as const, assetType: 'leveraged_etf' as const, broker: 'LONGPORT' },
  { id: 'sgov', symbol: 'SGOV', name: '现金类', shares: 10, buyPrice: 100, currentPrice: 100, sector: '现金', currency: 'USD' as const, assetType: 'etf' as const, broker: 'IBKR', cashEquivalent: true },
];

afterEach(() => vi.useRealTimers());

describe('BuyDecisionSection', () => {
  it('shows raw evidence without resurrecting the verdict panel', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot & { final_verdict?: Record<string, unknown> };
    snapshot.final_verdict = {
      SOXL: {
        symbol: 'SOXL', verdict: 'NO_BUY',
        single_sentence: '不买：SOXX 还需再跌 25.4% 到 $393.01',
        is_silence_by_rule: true, data_as_of: '2026-07-27', data_stale_days: 0, data_stale: false,
        blocking_layers: [{ layer: 'entry_gate_1x', reason: '基准 SOXX 回撤 -19.5%，未达 -40%' }],
        passing_layers: ['gates_six'], unknown_layers: [],
        layers: [
          { layer: 'gates_six', label: '六关', state: 'passed', passed: true, applicable: true, reason: '六关 6/6 已通过' },
          { layer: 'entry_gate_1x', label: '1x 入场门', state: 'failed', passed: false, applicable: true, reason: 'SOXX 未达阈值', benchmark: 'SOXX', gap_pp: 20.5, trigger_price: 393.01 },
          { layer: 'sleeve_borrow', label: '板块额度', state: 'failed', passed: false, applicable: true, reason: '科技超硬顶' },
          { layer: 'buy_plan_conditions', label: '计划条件', state: 'failed', passed: false, applicable: true, reason: '计划条件尚未满足' },
          { layer: 'panic_window', label: '恐慌窗口', state: 'failed', passed: false, applicable: true, reason: '等待双条件' },
        ],
      },
    };

    const html = renderToStaticMarkup(<BuyDecisionSection snapshot={snapshot} initialSymbol="SOXL" />);

    // The verdict panel was removed on purpose; the raw evidence stays.
    expect(html).not.toContain('最终裁决');
    expect(html).not.toContain('任何一层否决 = 不买');
    expect(html).toContain('恐慌抢买窗口');
  });

  it('keeps all five server-owned verdict rows visible when an older snapshot only exposes blocker and pass lists', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot & { final_verdict?: Record<string, unknown> };
    snapshot.final_verdict = {
      SOXL: {
        symbol: 'SOXL', verdict: 'NO_BUY', single_sentence: '不买：SOXX 还未到触发价。',
        blocking_layers: [{ layer: 'entry_gate_1x', reason: '需要：SOXX → $393.01' }],
        passing_layers: ['gates_six'],
        unknown_layers: ['sleeve_borrow', 'buy_plan_conditions', 'panic_window'],
      },
    };

    const html = renderToStaticMarkup(<BuyDecisionSection snapshot={snapshot} initialSymbol="SOXL" />);

    // Verdict layers are gone; raw evidence carries the numbers now.
    expect(html).not.toContain('最终裁决');
    expect(html).toContain('恐慌抢买窗口');
  });

  it('states that the loaded snapshot refreshes every 5 minutes in market and 25 otherwise', () => {
    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).toContain('盘中每 5 分钟；其他时段每 25 分钟自动更新');
  });

  it('uses a locked snapshot-symbol select and filters cash equivalents', () => {
    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).toContain('<select');
    expect(html).toContain('value="AAPL"');
    expect(html).toContain('value="SOXL"');
    expect(html).not.toContain('value="SGOV"');
    expect(html).not.toContain('placeholder="例如 SOXL"');
    expect(html).not.toContain('>查询</button>');
  });

  it('uses final-verdict status dots rather than independently derived opportunity states', () => {
    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={quantAnalysisFixture} holdings={holdings} initialSymbol="SOXL" />,
    );

    expect(html).toContain('SOXL · 待更新');
    expect(html).toContain('AMZN · 待更新');
    expect(html).toContain('h-2 w-2 shrink-0 rounded-full bg-neutral');
    expect(html).not.toContain('⚪');
    expect(html).toContain('AAPL · 待更新');
  });

  it('shows successful refresh feedback with the snapshot timestamp and minute age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T14:12:59.000Z'));

    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={quantAnalysisFixture} onRefresh={() => undefined} />,
    );

    expect(html).toContain('快照 2026-07-15 10:00 ET，12 分钟前');
  });

  it('renders the server-authored panic status above an applicable 3x symbol card', () => {
    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).toContain('疯狂提醒中');
    expect(html).toContain('1× 基准判定');
    expect(html).toContain('SOXX 闭市价 $465.00');
    expect(html).toContain('MA120 还差 2.53%');
    expect(html).toContain('夜盘价 $469.25（仅展示，不改变条件）');
    expect(html).toContain('恐慌位 ✓');
    expect(html).toContain('目标 20% / 当前 3.2%');
    expect(html).toContain('value="16"');
  });

  it('shows the Shanghai checkpoint status without inventing a notification result', () => {
    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).toContain('定时审查：夜盘审查');
    expect(html).toContain('美股交易日 2026-07-17');
    expect(html).toContain('下一检查点 11:00');
    expect(html).toContain('本次已通知 1 条');
  });

  it('does not render a panic status for a symbol absent from the backend block', () => {
    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={quantAnalysisFixture} initialSymbol="AAPL" />,
    );

    expect(html).not.toContain('恐慌抢买窗口');
  });

  it('renders stock own-depth first and removes CNN SOXX and NDX from its card', () => {
    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={quantAnalysisFixture} initialSymbol="AAPL" />,
    );

    expect(html).toContain('深度买入窗口（个股）');
    expect(html).toContain('深度位 ✓');
    expect(html).toContain('当前回撤</span><strong class="text-2xl tabular-nums">22.50%');
    expect(html).toContain('阈值</span><strong class="text-2xl tabular-nums">21.70%');
    expect(html).toContain('60 日胜率 68.00%');
    expect(html).toContain('（n=25）');
    expect(html).not.toContain('CNN 29.00');
    expect(html).not.toContain('SOXX');
    expect(html).not.toContain('纳指100');
  });

  it('renders backend-authored ready and near depth highlights without recomputing thresholds', () => {
    const ready = renderToStaticMarkup(
      <BuyDecisionSection snapshot={quantAnalysisFixture} initialSymbol="AAPL" />,
    );
    const near = renderToStaticMarkup(
      <BuyDecisionSection snapshot={quantAnalysisFixture} initialSymbol="AMZN" />,
    );

    expect(ready).toContain('✓ 已达标');
    expect(ready).toContain('当前回撤</span><strong class="text-2xl tabular-nums">22.50%');
    expect(ready).toContain('阈值</span><strong class="text-2xl tabular-nums">21.70%');
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
      <BuyDecisionSection snapshot={snapshot} holdings={quotedHoldings} initialSymbol="AAPL" />,
    );

    expect(html).toContain('现价 $384.98');
    expect(html).toContain('高点 ~$492.30');
    expect(html).toContain('阈值价 ~$412.35');
    expect(html).toContain('价格由行情代理现价与量化回撤反推，与量化取价时段（夜盘）可能有偏差');
    expect(html).toContain('高点为反推值，会随现价与量化回撤的更新时差而小幅变动；量化系统提供真实高点后此处将改为固定值。');
  });

  it('shows a premarket ET badge beside a proxy-derived depth price', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.symbols.AAPL.depth_window = {
      ...snapshot.symbols.AAPL.depth_window!,
      current_price: null,
      high_price: null,
      threshold_price: null,
      price_session: 'regular',
    };
    const quotedHoldings = [{
      ...holdings[0],
      id: 'aapl-session',
      symbol: 'AAPL',
      quote: {
        symbol: 'AAPL',
        price: 388,
        previousClose: 390.34,
        change: -2.34,
        changePercent: -0.006,
        currency: 'USD' as const,
        timestamp: '2026-07-23T13:20:00Z',
        source: 'proxy' as const,
        session: 'pre' as const,
        priceTime: '2026-07-23T13:20:00Z',
      },
    }];

    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={snapshot} holdings={quotedHoldings} initialSymbol="AAPL" />,
    );

    expect(html).toContain('现价 $388.00（盘前 09:20 ET）');
    expect(html).toContain('量化快照取价为盘中，当前行情为盘前；回撤百分比基于量化取价计算。');
  });

  it('keeps legacy quote data without session metadata compatible and badge-free', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.symbols.AAPL.depth_window = {
      ...snapshot.symbols.AAPL.depth_window!,
      current_price: null,
      high_price: null,
      threshold_price: null,
      price_session: '',
    };
    const legacyHoldings = [{
      ...holdings[0],
      id: 'aapl-legacy',
      symbol: 'AAPL',
      quote: {
        symbol: 'AAPL',
        price: 388,
        previousClose: 390.34,
        change: -2.34,
        changePercent: -0.006,
        currency: 'USD' as const,
        timestamp: '2026-07-23T13:20:00Z',
        source: 'proxy' as const,
      },
    }];

    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={snapshot} holdings={legacyHoldings} initialSymbol="AAPL" />,
    );

    expect(html).toContain('现价 $388.00');
    expect(html).not.toContain('盘前');
    expect(html).not.toContain('当前行情为');
  });

  it('shows a closed-market previous-close sentence without a session badge', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.symbols.AAPL.depth_window = {
      ...snapshot.symbols.AAPL.depth_window!,
      current_price: null,
      high_price: null,
      threshold_price: null,
      price_session: 'closed',
    };
    const closedHoldings = [{
      ...holdings[0],
      id: 'aapl-closed',
      symbol: 'AAPL',
      quote: {
        symbol: 'AAPL',
        price: 390.34,
        previousClose: 397.75,
        change: -7.41,
        changePercent: -0.0186,
        currency: 'USD' as const,
        timestamp: '2026-07-25T14:00:00Z',
        source: 'proxy' as const,
        session: 'closed' as const,
        priceTime: '2026-07-25T14:00:00Z',
        regularMarketPrice: 390.34,
      },
    }];

    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={snapshot} holdings={closedHoldings} initialSymbol="AAPL" />,
    );

    expect(html).toContain('休市 · 上一交易日收盘价 $390.34');
    expect(html).not.toContain('（休市');
    expect(html).not.toContain('取价时段：休市');
  });

  it('states the overnight coverage limit instead of presenting a regular close as overnight', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.symbols.AAPL.depth_window = {
      ...snapshot.symbols.AAPL.depth_window!,
      price_session: 'regular',
      price_note: '夜盘价格暂无，使用上一正常时段收盘价',
    };

    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={snapshot} initialSymbol="AAPL" />,
    );

    expect(html).toContain('夜盘价格暂无（数据源不覆盖）');
  });

  it('prefers a holding quote over a monitored quote and returns null when both are missing', () => {
    const quotedHoldings = [{
      ...holdings[0],
      quote: {
        symbol: 'MSFT',
        price: 401,
        previousClose: 400,
        change: 1,
        changePercent: 0.0025,
        currency: 'USD' as const,
        timestamp: '2026-07-22T12:00:00Z',
        source: 'proxy' as const,
      },
    }];
    const monitored = new Map([['MSFT', 399], ['AVGO', 396.81]]);

    expect(depthQuotePrice(quotedHoldings, monitored, 'MSFT')).toBe(401);
    expect(depthQuotePrice(quotedHoldings, monitored, 'AVGO')).toBe(396.81);
    expect(depthQuotePrice(quotedHoldings, monitored, 'MU')).toBeNull();
  });

  it('uses a monitored quote to derive prices for an unheld symbol', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.symbols.AAPL.depth_window = {
      ...snapshot.symbols.AAPL.depth_window!,
      current_pct: -21.8,
      threshold_pct: -16.24,
      current_price: null,
      high_price: null,
      threshold_price: null,
    };

    const html = renderToStaticMarkup(
      <BuyDecisionSection
        snapshot={snapshot}
        holdings={[]}
        monitoredQuotes={new Map([['AAPL', 384.98]])}
        initialSymbol="AAPL"
      />,
    );

    expect(html).toContain('现价 $384.98');
    expect(html).toContain('高点 ~$492.30');
    expect(html).toContain('阈值价 ~$412.35');
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
      <BuyDecisionSection snapshot={snapshot} initialSymbol="AAPL" />,
    );

    expect(html).toContain('现价 $380.00');
    expect(html).toContain('高点 $490.00');
    expect(html).toContain('阈值价 $410.00');
    expect(html).not.toContain('高点 ~$490.00');
    expect(html).not.toContain('价格由行情代理现价与量化回撤反推');
    expect(html).not.toContain('高点为反推值，会随现价与量化回撤的更新时差而小幅变动');
  });

  it('keeps the percentage-only card when neither quant nor quote prices exist', () => {
    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={quantAnalysisFixture} initialSymbol="AAPL" />,
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
      <BuyDecisionSection snapshot={snapshot} initialSymbol="AMZN" />,
    );
    const insufficient = renderToStaticMarkup(
      <BuyDecisionSection snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(far).toContain('未达标');
    expect(far).toContain('value="55.55"');
    expect(far).toContain('dark:');
    expect(insufficient).not.toContain('最终裁决');
    expect(insufficient).toContain('text-ink-muted');
    expect(insufficient).toContain('min-w-0');
    expect(insufficient).toContain('overflow-hidden');
  });

  it('highlights the panic result and names its trigger session', () => {
    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).toContain('恐慌位 ✓ 已触发');
    expect(html).toContain('触发时段：盘中');
  });

  it('shows the exact snapshot age when quant data is stale', () => {
    const snapshot = {
      ...quantAnalysisFixture,
      generated_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    };
    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={snapshot} initialSymbol="SOXL" />,
    );

    expect(html).toContain('量化分析数据 25 小时前，可能过期');
  });

  it('shows the mandatory warning instead of a win rate for samples below 20', () => {
    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
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
      <BuyDecisionSection snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
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
      <BuyDecisionSection snapshot={snapshot} initialSymbol="SOXL" />,
    );

    expect(html).toContain('回撤深度 60%');
    expect(html).toContain('60 日历史成功率 68.00%（n=25）');
    expect(html).toContain('含熊市样本：是');
  });

});

describe('entry evidence shows price and valuation only', () => {
  it('drops the 六关 wording and the discipline-gate block', () => {
    const snapshot = {
      source: 'futu-assistant', generated_at: '2026-07-31T13:14:00-04:00',
      rule_version: '2.7', disclaimer: '', context: {},
      symbols: {
        AVGO: {
          available: true,
          gates: {
            low_zone: { passed: true, applicable: true, current_drawdown_pct: -21.17, threshold_pct: -16.24 },
            valuation: { passed: true, applicable: true, reason: '估值通过', stock_percentile: 18.8 },
            signal_triggered: { passed: false, applicable: true, recent_buy_signals: [] },
            position_gate: { passed: true, applicable: true, family_share_pct: 0, cap_pct: 10 },
            batch_available: { passed: true, applicable: true, next_batch: 1, batch_count: 3 },
            daily_fuse: { passed: true, applicable: true, buys_today: 0, max_new_buys: 2 },
          },
        },
      },
      final_verdict: { symbols: { AVGO: { symbol: 'AVGO', verdict: 'BUY', single_sentence: '条件完整', layers: [] } } },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={snapshot} initialSymbol="AVGO" />,
    );

    expect(html).not.toContain('六关');
    expect(html).not.toContain('纪律闸门');
    expect(html).not.toContain('仓位门');
    expect(html).not.toContain('批次');
  });
});

describe('quant evidence is not collapsed away', () => {
  it('renders the panic window without the 量化原始证据 disclosure wrapper', () => {
    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).not.toContain('量化原始证据（不单独构成结论）');
    expect(html).not.toContain('量化原始证据');
    expect(html).toContain('恐慌抢买窗口');
    expect(html).toContain('1× 基准判定');
  });

  it('names the moving average as the blocker once the drawdown itself is satisfied', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    const gate = snapshot.panic_window!.symbols.SOXL.entry_gate!;
    gate.drawdown = { current_pct: 15.86, required_pct: 11, passed: true };
    gate.passed = false;
    gate.moving_averages = [
      { period: 100, value: 176.2, touched: false, gap_pct: 0.24 },
      { period: 120, value: 170.1, touched: true, gap_pct: 0 },
    ];

    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={snapshot} initialSymbol="SOXL" />,
    );

    expect(html).toContain('回撤条件已满足，卡在均线：MA100 还差 0.24%');
  });
});

describe('historical sample block', () => {
  it('does not open with 没有样本 when a drawdown-depth sample exists', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.symbols.AAPL.signal_stats = {};
    snapshot.symbols.AAPL.depth_stats = {
      level_pct: 10, n: 24, win_rate_60d: 0.791667, sample_insufficient: false, bear_included: true,
    };

    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={snapshot} initialSymbol="AAPL" />,
    );

    expect(html).not.toContain('当前没有可展示的历史事件样本');
    expect(html).toContain('60 日历史成功率 79.17%（n=24）');
  });

  it('still says so when neither sample exists', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.symbols.AAPL.signal_stats = {};
    snapshot.symbols.AAPL.depth_stats = null;

    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={snapshot} initialSymbol="AAPL" />,
    );

    expect(html).toContain('当前没有可展示的历史事件样本');
  });
});

describe('valuation price source', () => {
  it('falls back to the quant snapshot price when no holding or monitored quote exists', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    (snapshot.symbols.AAPL.depth_window as unknown as Record<string, unknown>).current_price = 308.91;

    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={snapshot} holdings={[]} monitoredQuotes={new Map()} initialSymbol="AAPL" />,
    );

    expect(html).not.toContain('data-valuation-field="price">股价 暂无');
    expect(html).toContain('data-valuation-field="price">股价 $308.91');
    expect(html).toContain('量化快照价');
  });
});

describe('verdict panel removed', () => {
  it('no longer renders the final-verdict block', () => {
    const html = renderToStaticMarkup(
      <BuyDecisionSection snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).not.toContain('最终裁决');
    expect(html).not.toContain('任何一层否决');
    expect(html).toContain('恐慌抢买窗口');
    expect(html).toContain('估值基准');
  });
});
