import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { quantAnalysisFixture } from '../testFixtures/quantAnalysis';
import type { QuantAnalysisSnapshot } from '../types';
import { SellWindowSection } from './SellWindowSection';

const holdings = [
  { id: 'msft', symbol: 'MSFT', name: '微软', shares: 10, buyPrice: 300, currentPrice: 400, sector: '科技', currency: 'USD' as const, assetType: 'stock' as const, broker: 'IBKR' },
  { id: 'msfu-option', symbol: 'MSFU CALL', name: 'MSFU Call', shares: 2, buyPrice: 2, currentPrice: 3, sector: '科技', currency: 'USD' as const, assetType: 'option' as const, broker: 'FUTU', option: { underlying: 'MSFU', optionType: 'call' as const, strike: 30, expiration: '2027-01-15', contractMultiplier: 100, delta: 0.4, theta: null, gamma: null, vega: null, impliedVolatility: null, underlyingPrice: 25 } },
  { id: 'tqqq', symbol: 'TQQQ', name: 'TQQQ', shares: 10, buyPrice: 50, currentPrice: 60, sector: 'ETF', currency: 'USD' as const, assetType: 'leveraged_etf' as const, broker: 'LONGPORT' },
  { id: 'sgov', symbol: 'SGOV', name: '现金类', shares: 10, buyPrice: 100, currentPrice: 100, sector: '现金', currency: 'USD' as const, assetType: 'etf' as const, broker: 'IBKR', cashEquivalent: true },
];

afterEach(() => vi.useRealTimers());

describe('SellWindowSection', () => {
  it('renders touch-accessible disclosure controls for sell-rule explanations', () => {
    const html = renderToStaticMarkup(
      <SellWindowSection snapshot={quantAnalysisFixture} holdings={holdings} initialSymbol="AAPL" />,
    );

    expect(html).toContain('aria-label="说明：修复期口径"');
    expect(html).toContain('aria-label="说明：止盈阶梯适用条件"');
    expect(html).toContain('min-h-11');
    expect(html).not.toContain('title="这是市场维度');
    expect(html).not.toContain('title="只在浮盈达到最低档后适用');
  });

  it('labels a held symbol with its market value, broker and sell state', () => {
    const html = renderToStaticMarkup(
      <SellWindowSection snapshot={quantAnalysisFixture} holdings={holdings} initialSymbol="SOXL" />,
    );

    expect(html).toContain('MSFT · 市值 $4,000.00 · IBKR · 观察期</button>');
    expect(html).toContain('h-2 w-2 shrink-0 rounded-full bg-trim');
    expect(html).not.toContain('🟠 MSFT');
  });

  it('omits an empty sell-status suffix instead of appending dot-none', () => {
    const html = renderToStaticMarkup(
      <SellWindowSection snapshot={quantAnalysisFixture} holdings={holdings} initialSymbol="AAPL" />,
    );

    expect(html).not.toContain('· 无</button>');
    expect(html).toContain('TQQQ · 市值 $600.00 · LONGPORT</button>');
  });

  it('renders a held-only sell selector and the server-authored repair window', () => {
    const html = renderToStaticMarkup(
      <SellWindowSection snapshot={quantAnalysisFixture} holdings={holdings} initialSymbol="AAPL" />,
    );

    expect(html).toContain('aria-label="卖出持仓标的"');
    expect(html).toContain('value="MSFT"');
    expect(html).toContain('value="MSFU"');
    expect(html).toContain('value="TQQQ"');
    expect(html).not.toContain('value="SGOV"');
    expect(html).toContain('卖出窗口未开启：深跌修复期内，耐心持有（基准日 2026-03-30）');
    expect(html).toContain('量化剧本参考比例 50%');
    expect(html).toContain('市场亢奋·量化剧本参考：清仓杠杆品种或调仓 SGOV');
    expect(html).toContain('止盈阶梯参考 · 剧本：个股');
    expect(html).toContain('低点到高点 · 概率卖出计划');
    expect(html).toContain('低点反弹 +12.00%');
    expect(html).toContain('目标价 $448.00');
    expect(html).toContain('历史到达 83.3% · 中位 20 个交易日');
    expect(html).toContain('历史分位，仅作辅助确认');
    expect(html).toContain('历史低点反弹率不得替代账户盈利率');
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
      <SellWindowSection snapshot={snapshot} holdings={holdings} initialSymbol="MSFT" />,
    );

    expect(html).toContain('MSFT · 市值 $4,000.00 · IBKR · 卖出窗口开启</button>');
    expect(html).toContain('h-2 w-2 shrink-0 rounded-full bg-buy');
    expect(html).not.toContain('MSFT · 市值 $4,000.00 · IBKR · 观察期</button>');
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
      <SellWindowSection snapshot={snapshot} holdings={holdings} initialSymbol="MSFT" />,
    );

    expect(html).toContain('量化卖出模块当前为观察期，全部信号均未正式生效');
    expect(html).not.toContain('卖出窗口开启');
    expect(html).toContain('MSFT · 市值 $4,000.00 · IBKR · 观察期</button>');
  });

  it('shows an explicit fallback when the quant playbook has no label', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.sell!.symbols.MSFT.playbook.label = undefined;
    const html = renderToStaticMarkup(
      <SellWindowSection snapshot={snapshot} holdings={holdings} initialSymbol="MSFT" />,
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
      <SellWindowSection snapshot={snapshot} holdings={sharedHoldings} initialSymbol="SHARED" />,
    );

    expect(html).toContain('该标的同时属于多个族，已按市值最大者展示');
    expect(html).toContain('&quot;family&quot;: &quot;LARGE&quot;');
  });

  it('shows family loss and disables profit-taking ladder emphasis', () => {
    const losingHoldings = [
      { ...holdings[0], shares: 10, buyPrice: 100, currentPrice: 80 },
    ];
    const html = renderToStaticMarkup(
      <SellWindowSection snapshot={quantAnalysisFixture} holdings={losingHoldings} initialSymbol="MSFT" />,
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

  it('uses the backend profit gate and keeps a repaired losing family non-actionable', () => {
    const snapshot = {
      ...quantAnalysisFixture,
      sell: {
        ...quantAnalysisFixture.sell,
        symbols: {
          ...quantAnalysisFixture.sell.symbols,
          MSFT: {
            ...quantAnalysisFixture.sell.symbols.MSFT,
            profit_gate: {
              available: true,
              market_value: 800,
              cost: 1_000,
              unrealized_pnl_usd: -200,
              unrealized_pnl_pct: -20,
              in_profit: false,
              min_ladder_gain_pct: 5,
              reaches_first_ladder: false,
              verdict: 'hold_loss',
              verdict_text: '当前浮亏 -20.00%，按你的规则继续持有，不减仓',
            },
            repair: {
              ...quantAnalysisFixture.sell.symbols.MSFT.repair,
              status: 'complete',
              window_open: true,
              actionable: false,
              display_text: '市场已修复，但你的仓位仍浮亏 -20.00%，按你的规则继续持有',
            },
          },
        },
      },
    } as unknown as QuantAnalysisSnapshot;
    const losingHoldings = [
      { ...holdings[0], shares: 10, buyPrice: 100, currentPrice: 80 },
    ];
    const html = renderToStaticMarkup(
      <SellWindowSection snapshot={snapshot} holdings={losingHoldings} initialSymbol="MSFT" />,
    );

    expect(html).toContain('当前浮亏 -20.00%，按你的规则继续持有，不减仓');
    expect(html).toContain('市场已修复，但你的仓位仍浮亏 -20.00%，按你的规则继续持有');
    expect(html).toContain('这是市场维度（相对 QQQ 强弱），与你的买入成本无关');
    expect(html).toContain('只在浮盈达到最低档 +5.00% 后适用');
    expect(html).toContain('data-profit-actionable="false"');
    expect(html).not.toContain('修复完成，可开始分批减仓');
    expect(html.indexOf('本族当前盈亏')).toBeLessThan(html.indexOf('当前浮亏 -20.00%'));
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
      <SellWindowSection snapshot={snapshot} holdings={partialHoldings} initialSymbol="MSFT" />,
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
      <SellWindowSection snapshot={snapshot} holdings={partialHoldings} initialSymbol="MSFT" />,
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
      <SellWindowSection snapshot={snapshot} holdings={profitableHoldings} initialSymbol="MSFT" />,
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
      <SellWindowSection snapshot={quantAnalysisFixture} holdings={partialGainHoldings} initialSymbol="MSFT" />,
    );

    expect(html).toContain('data-active="true"');
    expect(html).toContain('该档位基于已计成本部分（另有 1 个持仓成本未知），实际盈利可能不同；减仓比例请以券商实际成本为准。');
  });

  it('does not qualify an active profit tier when family cost coverage is complete', () => {
    const html = renderToStaticMarkup(
      <SellWindowSection
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
      <SellWindowSection snapshot={quantAnalysisFixture} holdings={partialBelowFirstHoldings} initialSymbol="MSFT" />,
    );

    expect(html).toContain('距第一档 +5.00% 还差 3.00 点（基于已计成本部分）');
  });

  it('shows only market value and unknown cost when family costs are unavailable', () => {
    const missingCostHoldings = [{ ...holdings[0], shares: 10, buyPrice: 0, currentPrice: 80 }];
    const snapshot = { ...quantAnalysisFixture, holding_costs: {} };
    const html = renderToStaticMarkup(
      <SellWindowSection snapshot={snapshot} holdings={missingCostHoldings} initialSymbol="MSFT" />,
    );

    expect(html).toContain('市值 $800.00');
    expect(html).toContain('成本未知');
    expect(html).not.toContain('浮盈亏');
    expect(html).not.toMatch(/成本未知[^<]*%/);
  });

  it('tells users to fill the holdings table when only non-option costs are unknown', () => {
    const snapshot = { ...quantAnalysisFixture, holding_costs: {} };
    const html = renderToStaticMarkup(
      <SellWindowSection
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
      <SellWindowSection
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
