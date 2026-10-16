import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PeHistoryPayload } from '../peData';
import type { QuantAnalysisSnapshot } from '../types';
import { SellDecisionDashboard } from './SellDecisionDashboard';
import sellDashboardSource from './SellDecisionDashboard.tsx?raw';

const rates = { USD: 1, CNY: 7, HKD: 7.8, JPY: 150, EUR: 0.9, GBP: 0.8, updatedAt: null, source: 'fallback' } as const;

const synchronizedSnapshot = {
  generated_at: '2026-08-08T13:05:00-04:00',
  context: {},
  sell: { shadow: false, symbols: {
    NVDA: {
      family: 'NVDA', market_value: 2000, held_symbols: ['NVDA'], recent_signals: [],
      profit_gate: { unrealized_pnl_usd: 500, unrealized_pnl_pct: 33 },
      decision: {
        verdict: 'WAIT', label: '再等等', notification_state: 'wait', reason: 'NVDA 暂不卖出', recommended_sell_pct: 0,
        evidence: {
          profit: { status: 'ready', pnl_pct: 33, threshold_pct: 5 },
          history: { status: 'far', sample_count: 5, current_gain_pct: 30, target_gain_pct: 50, gap_pct: 20, historical_reach_pct: 70, sell_holding_pct: 20 },
          valuation: { status: 'normal', percentile: 4.9, source: '持仓标的', current_pe: 34.3, average_pe: 74.05 },
          sentiment: { status: 'normal', score: 64 }, relative_strength_hot: false, recent_signals: [],
        },
      },
    },
    MSFT: {
      family: 'MSFT', market_value: 1000, held_symbols: ['MSFT'], recent_signals: [],
      profit_gate: { unrealized_pnl_usd: 280, unrealized_pnl_pct: 39.5 },
      decision: {
        verdict: 'WAIT', label: '再等等', notification_state: 'wait', reason: 'MSFT 暂不卖出', recommended_sell_pct: 0,
        evidence: {
          profit: { status: 'ready', pnl_pct: 39.5, threshold_pct: 5 },
          history: { status: 'far', sample_count: 5, current_gain_pct: 31, target_gain_pct: 52, gap_pct: 21, historical_reach_pct: 66, sell_holding_pct: 20 },
          valuation: { status: 'normal', percentile: 22.9, source: '持仓标的', current_pe: 27.85, average_pe: 34.11 },
          sentiment: { status: 'normal', score: 64 }, relative_strength_hot: false, recent_signals: [],
        },
      },
    },
  } },
} as unknown as QuantAnalysisSnapshot;

const synchronizedTtm: PeHistoryPayload = {
  generated_at: '2026-08-08T13:05:00-04:00', metric: 'ttm_pe', frequency: 'daily',
  percentile_definition: '当前值在5年历史中的分位', lookback_years: 5,
  symbols: {
    NVDA: { current: 34.3, percentile: 4.9, series_start: '2021-08-09', series: [{ date: '2026-08-07', value: 34.3 }], source: 'Futu OpenD', frequency: 'daily' },
    MSFT: { current: 27.85, percentile: 22.9, series_start: '2021-08-09', series: [{ date: '2026-08-07', value: 27.85 }], source: 'Futu OpenD', frequency: 'daily' },
  },
};

describe('SellDecisionDashboard', () => {
  it('uses the symbol selected by the valuation explorer instead of silently falling back to another holding', () => {
    const html = renderToStaticMarkup(
      <SellDecisionDashboard
        snapshot={synchronizedSnapshot}
        holdings={[]}
        displayCurrency="USD"
        rates={rates}
        selectedFamily="MSFT"
        ttmHistory={synchronizedTtm}
        initialOpen
      />,
    );

    expect(html).toContain('MSFT · 继续等待');
    expect(html).toContain('当前 TTM PE');
    expect(html).toContain('27.85');
    expect(html).not.toContain('当前 TTM PE</dt><dd class="font-semibold tabular-nums">34.30');
  });

  it('keeps the command center compact until the user opens the holding selector', () => {
    const html = renderToStaticMarkup(
      <SellDecisionDashboard
        snapshot={synchronizedSnapshot}
        holdings={[]}
        displayCurrency="USD"
        rates={rates}
        selectedFamily="MSFT"
        ttmHistory={synchronizedTtm}
      />,
    );

    expect(html).toContain('查看 2 个持仓军令');
    expect(html).toContain('不允许卖出');
    expect(html).not.toContain('SELL COMMAND CENTER');
    expect(html).not.toContain('量化持仓实时计价');
    expect(html).not.toContain('执行序列');
    expect(html).not.toContain('估值与卖出测算');
  });

  it('shows the same full-refresh control and progress message used by the buy page', () => {
    const html = renderToStaticMarkup(
      <SellDecisionDashboard
        snapshot={synchronizedSnapshot}
        holdings={[]}
        displayCurrency="USD"
        rates={rates}
        selectedFamily="MSFT"
        ttmHistory={synchronizedTtm}
        onRefresh={() => undefined}
        refreshState={{ phase: 'waiting', message: '服务器正在重新计算买入与卖出数据…' }}
      />,
    );

    expect(html).toContain('刷新中…');
    expect(html).toContain('服务器正在重新计算买入与卖出数据…');
  });

  it('wraps compact profit and reason text instead of clipping it on mobile', () => {
    const html = renderToStaticMarkup(
      <SellDecisionDashboard
        snapshot={synchronizedSnapshot}
        holdings={[]}
        displayCurrency="USD"
        rates={rates}
        selectedFamily="MSFT"
        ttmHistory={synchronizedTtm}
      />,
    );

    expect(html).toContain('break-all text-xs font-bold tabular-nums');
    expect(html).toContain('break-words text-xs text-ink-secondary');
    expect(html).not.toContain('mt-0.5 truncate text-xs font-bold tabular-nums');
    expect(html).not.toContain('mt-2 truncate text-xs text-ink-secondary');
  });

  it('shows a concise sell-price plan for every held family before opening the dialog', () => {
    const snapshot = {
      ...synchronizedSnapshot,
      sell: { shadow: false, symbols: {
        NVDA: {
          ...synchronizedSnapshot.sell!.symbols.NVDA,
          sell_price_plan: {
            available: true, method: 'forward_pe', basis_symbol: 'NVDA',
            current_price: 223.96, current_forward_pe: 22.148,
            implied_forward_eps: 10.111522, sell_forward_pe: 30,
            sell_price: 303.36, clear_forward_pe: 32, clear_price: 323.58,
            gap_pct: 35.45, status: 'waiting', quality: 'current_estimate',
            source: 'Futu OpenD', as_of: '2026-08-09 13:50:08',
            target_portfolio_weight_pct: 5,
            note: '按当前预测 EPS 不变测算；分析师调整盈利预期后，价格会同步变化',
          },
        },
        MSFT: {
          ...synchronizedSnapshot.sell!.symbols.MSFT,
          sell_price_plan: {
            available: true, method: 'historical_cycle', basis_symbol: 'MSFT',
            current_price: 499.99, current_forward_pe: null,
            implied_forward_eps: null, sell_forward_pe: null,
            sell_price: 536.41, clear_forward_pe: null, clear_price: null,
            gap_pct: 7.28, status: 'waiting', quality: 'reference_only',
            source: 'MSFT 独立回撤周期', as_of: '2026-08-07', sample_count: 3,
            target_portfolio_weight_pct: null,
            note: '没有可靠远期 PE；采用 MSFT 历史周期保守卖点',
          },
        },
      } },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(
      <SellDecisionDashboard
        snapshot={snapshot}
        holdings={[]}
        displayCurrency="USD"
        rates={rates}
        selectedFamily="NVDA"
        ttmHistory={synchronizedTtm}
      />,
    );

    expect(html).toContain('全部持仓卖出价格');
    expect(html).toContain('NVDA');
    expect(html).toContain('$303.36');
    expect(html).toContain('远期 PE 30');
    expect(html).toContain('$323.58');
    expect(html).toContain('MSFT');
    expect(html).toContain('$536.41');
    expect(html).toContain('仅参考');
    expect(html).toContain('当前卖出线');
    expect(html).toContain('data-testid="mobile-sell-price-list"');
    expect(html).toContain('data-testid="mobile-sell-price-row"');
  });

  it('keeps sell prices in a collapsed drawer and sorts executable holdings first', () => {
    const wait = synchronizedSnapshot.sell!.symbols.NVDA;
    const snapshot = {
      ...synchronizedSnapshot,
      sell: { shadow: false, symbols: {
        WAITING: { ...wait, family: 'WAITING', held_symbols: ['WAITING'] },
        READY: {
          ...wait,
          family: 'READY', held_symbols: ['READY'],
          decision: {
            ...wait.decision!, verdict: 'SELL', notification_state: 'sell',
            label: '可以卖出', reason: '卖出条件已经满足', recommended_sell_pct: 20,
          },
        },
      } },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(
      <SellDecisionDashboard snapshot={snapshot} holdings={[]} displayCurrency="USD" rates={rates} />,
    );

    expect(html).toContain('<details data-testid="mobile-sell-price-list"');
    expect(html).not.toContain('<details data-testid="mobile-sell-price-list" open=""');
    expect(html).toContain('1 个可卖 · 1 个等待');
    expect(html.indexOf('<strong class="text-sm">READY</strong>')).toBeLessThan(html.indexOf('<strong class="text-sm">WAITING</strong>'));
  });

  it('selects a sell-price row without opening the command dialog', () => {
    const listCall = sellDashboardSource.slice(
      sellDashboardSource.indexOf('<SellPricePlanGrid'),
      sellDashboardSource.indexOf('{open && ('),
    );

    expect(listCall).toContain('onSelect={chooseFamily}');
    expect(listCall).not.toContain('setOpen(true)');
  });

  it('shows stock risk tiers and the QQQ trigger without inventing a TQQQ target price', () => {
    const nvda = synchronizedSnapshot.sell!.symbols.NVDA;
    const snapshot = {
      ...synchronizedSnapshot,
      sell: { shadow: false, symbols: {
        NVDA: {
          ...nvda,
          sell_price_plan: {
            available: true, method: 'recovery_valuation', basis_symbol: 'NVDA',
            strategy_profile: 'high_growth_tolerant', action_stage_key: 'reduce_risk',
            current_price: 223.96, basis_current_price: 223.96,
            current_forward_pe: 22.148, current_ttm_pe: 34.297,
            implied_forward_eps: 10.111974, sell_forward_pe: null,
            sell_price: 239.04, trigger_price: 239.04,
            clear_forward_pe: null, clear_price: 260.5,
            gap_pct: 6.73, status: 'waiting', quality: 'current_estimate',
            source: '高增长宽容：独立回撤周期 + 远期 PE 上限', as_of: '2026-08-07',
            previous_high_price: 260.5, previous_high_date: '2026-06-02',
            target_portfolio_weight_pct: 5,
            note: 'NVDA/MU 使用高增长宽容线',
            stages: [
              { key: 'reduce_risk', label: '开始降风险', trigger_price: 239.04, trigger_kind: 'ttm_valuation', reached: false, action: '先卖半仓期权，再卖杠杆，正股不急卖' },
              { key: 'clear_derivatives', label: '清理衍生仓', trigger_price: 247.48, trigger_kind: 'prior_high_recovery', reached: false, action: '清理剩余期权和杠杆，继续保留正股核心仓' },
              { key: 'trim_stock', label: '正股分批减仓', trigger_price: 260.5, trigger_kind: 'prior_high_recovery', reached: false, action: '正股只分批减仓' },
              { key: 'extreme_valuation', label: '极端估值参考', trigger_price: 303.36, trigger_kind: 'forward_pe', reached: false, action: '极端估值继续减正股' },
            ],
          },
        },
        TQQQ: {
          ...nvda,
          family: 'TQQQ', held_symbols: ['TQQQ'],
          sell_price_plan: {
            available: true, method: 'benchmark_high', basis_symbol: 'QQQ',
            current_price: 74.47, basis_current_price: 723.03,
            current_forward_pe: null, current_ttm_pe: null,
            implied_forward_eps: null, sell_forward_pe: null, sell_price: null,
            trigger_price: 745.34, clear_forward_pe: null, clear_price: null,
            gap_pct: 3.08, status: 'waiting', quality: 'historical_reference',
            source: 'QQQ 历史新高', as_of: '2026-06-02',
            previous_high_price: 745.34, previous_high_date: '2026-06-02',
            target_portfolio_weight_pct: 5,
            note: '以 QQQ 回到历史新高为卖出触发；不伪造 TQQQ 目标价',
            stages: [{ key: 'benchmark_new_high', label: 'QQQ 回到新高', trigger_price: 745.34, trigger_kind: 'benchmark_high', reached: false, action: '先处理 TQQQ 期权，再分批减 TQQQ' }],
          },
        },
      } },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(
      <SellDecisionDashboard
        snapshot={snapshot}
        holdings={[]}
        displayCurrency="USD"
        rates={rates}
        selectedFamily="NVDA"
        ttmHistory={synchronizedTtm}
      />,
    );

    expect(html).toContain('$239.04 开始降风险');
    expect(html).toContain('高增长宽容线');
    expect(html).toContain('清衍生仓 $247.48');
    expect(html).toContain('正股分批 $260.50');
    expect(html).toContain('极端参考 $303.36');
    expect(html).toContain('QQQ 到 $745.34 触发');
    expect(html).toContain('TQQQ 现价 $74.47');
    expect(html).not.toContain('$745.34 开始卖');
  });

  it('labels a stock-only valuation trigger as a stock trim price', () => {
    const nvda = synchronizedSnapshot.sell!.symbols.NVDA;
    const snapshot = {
      ...synchronizedSnapshot,
      sell: { shadow: false, symbols: {
        AVGO: {
          ...nvda,
          family: 'AVGO', held_symbols: ['AVGO'],
          sell_price_plan: {
            available: true, method: 'recovery_valuation', basis_symbol: 'AVGO',
            strategy_profile: 'standard_stock', action_stage_key: 'trim_stock',
            current_price: 427.76, basis_current_price: 427.76,
            current_forward_pe: 32.536, current_ttm_pe: 71.174,
            implied_forward_eps: 13.147283, sell_forward_pe: null,
            sell_price: 394.42, trigger_price: 394.42,
            clear_forward_pe: null, clear_price: 420.71,
            gap_pct: 0, status: 'reached', quality: 'current_estimate',
            source: '历史高点 + 5年 TTM PE + 远期 PE', as_of: '2026-08-09',
            previous_high_price: 494.22, previous_high_date: '2026-06-03',
            target_portfolio_weight_pct: 5,
            note: '普通个股不豁免',
            stages: [
              { key: 'reduce_risk', label: '开始降风险', trigger_price: 263.69, trigger_kind: 'ttm_valuation', reached: true, action: '先减衍生仓' },
              { key: 'clear_derivatives', label: '清理衍生仓', trigger_price: 420.71, trigger_kind: 'forward_valuation', reached: true, action: '清理衍生仓' },
              { key: 'trim_stock', label: '正股分批减仓', trigger_price: 394.42, trigger_kind: 'forward_valuation', reached: true, action: '正股分批减仓' },
              { key: 'extreme_valuation', label: '极端估值参考', trigger_price: 494.22, trigger_kind: 'forward_pe', reached: false, action: '极端估值继续减正股' },
            ],
          },
        },
      } },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(
      <SellDecisionDashboard
        snapshot={snapshot}
        holdings={[]}
        displayCurrency="USD"
        rates={rates}
        selectedFamily="AVGO"
        ttmHistory={synchronizedTtm}
      />,
    );

    expect(html).toContain('$394.42 正股分批');
    expect(html).toContain('前高恢复 + 历史/远期估值');
  });

  it('blocks an executable sell command when the same stock has conflicting TTM values', () => {
    const msft = synchronizedSnapshot.sell!.symbols.MSFT;
    const sellSnapshot = {
      ...synchronizedSnapshot,
      sell: { shadow: false, symbols: {
        ...synchronizedSnapshot.sell!.symbols,
        MSFT: {
          ...msft,
          decision: {
            ...msft.decision!,
            verdict: 'SELL',
            label: '可以卖出',
            notification_state: 'sell',
            recommended_sell_pct: 20,
          },
        },
      } },
    } as unknown as QuantAnalysisSnapshot;
    const html = renderToStaticMarkup(
      <SellDecisionDashboard
        snapshot={sellSnapshot}
        holdings={[]}
        displayCurrency="USD"
        rates={rates}
        selectedFamily="MSFT"
        ttmHistory={{
          ...synchronizedTtm,
          symbols: {
            ...synchronizedTtm.symbols,
            MSFT: { ...synchronizedTtm.symbols.MSFT, current: 28.1 },
          },
        }}
        initialOpen
      />,
    );

    expect(html).toContain('数据待同步');
    expect(html).toContain('同一股票 TTM 不一致');
    expect(html).toContain('军令快照 27.85');
    expect(html).toContain('估值曲线 28.10');
  });

  it('keeps a waiting decision readable when harmless intraday TTM values drift', () => {
    const html = renderToStaticMarkup(
      <SellDecisionDashboard
        snapshot={synchronizedSnapshot}
        holdings={[]}
        displayCurrency="USD"
        rates={rates}
        selectedFamily="MSFT"
        ttmHistory={{
          ...synchronizedTtm,
          symbols: {
            ...synchronizedTtm.symbols,
            MSFT: { ...synchronizedTtm.symbols.MSFT, current: 28.1 },
          },
        }}
      />,
    );

    expect(html).toContain('MSFT 暂不卖出');
    expect(html).toContain('不允许卖出');
    expect(html).not.toContain('数据待同步');
    expect(html).not.toContain('同一股票的估值曲线与军令快照不一致');
  });

  it('does not compare a forward-PE sell command with the TTM history curve', () => {
    const msft = synchronizedSnapshot.sell!.symbols.MSFT;
    const snapshot = {
      ...synchronizedSnapshot,
      sell: { shadow: false, symbols: {
        MSFT: {
          ...msft,
          sell_price_plan: {
            available: true, method: 'forward_pe', basis_symbol: 'MSFT',
            current_price: 640, current_forward_pe: 32.54,
            implied_forward_eps: 19.6681, sell_forward_pe: 30,
            sell_price: 590.04, clear_forward_pe: 32, clear_price: 629.38,
            gap_pct: 0, status: 'reached', quality: 'current_estimate',
            source: 'Futu OpenD', as_of: '2026-08-09 13:50:08',
            target_portfolio_weight_pct: 5,
            note: '按当前预测 EPS 不变测算',
          },
          decision: {
            ...msft.decision,
            verdict: 'SELL', label: '可以卖出', notification_state: 'sell',
            reason: '远期 PE 32.54 已达到 32', recommended_sell_pct: 20,
            evidence: {
              ...msft.decision!.evidence,
              valuation: {
                ...msft.decision!.evidence.valuation,
                status: 'high', source: 'forward_pe_1bf', current_pe: 32.54,
              },
            },
          },
        },
      } },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(
      <SellDecisionDashboard
        snapshot={snapshot}
        holdings={[]}
        displayCurrency="USD"
        rates={rates}
        selectedFamily="MSFT"
        ttmHistory={{
          ...synchronizedTtm,
          symbols: {
            ...synchronizedTtm.symbols,
            MSFT: { ...synchronizedTtm.symbols.MSFT, current: 71.17 },
          },
        }}
        initialOpen
      />,
    );

    expect(html).toContain('允许卖出');
    expect(html).toContain('当前远期 PE');
    expect(html).toContain('32.54');
    expect(html).not.toContain('数据待同步');
    expect(html).not.toContain('同一股票 TTM 不一致');
  });

  it('renders a command-center sell plan with reasons, thresholds, staged reductions, and profit estimates', () => {
    const snapshot = {
      generated_at: '2026-08-03T10:20:00-04:00',
      context: {
        cnn_fear_greed: { score: 45 },
        ndx_valuation: { pe_percentile_5y: 22 },
      },
      sell: { shadow: false, symbols: {
        MSFT: {
          family: 'MSFT', market_value: 1000, held_symbols: ['MSFT'], recent_signals: [],
          positions: [{
            symbol: 'MSFT', asset_type: 'stock', broker: 'FUTU', quantity: 2,
            contract_multiplier: 1, current_price: 500, price_session: 'regular',
            price_note: null, market_value: 1000, cost_basis: 720, average_cost: 360,
            unrealized_pnl_usd: 280, unrealized_pnl_pct: 38.89,
          }],
          profit_gate: { unrealized_pnl_usd: 280, unrealized_pnl_pct: 39.5 },
          decision: {
            verdict: 'SELL', label: '可以卖出', notification_state: 'sell',
            reason: '估值已到 85 分位', recommended_sell_pct: 20,
            evidence: {
              profit: { status: 'ready', pnl_pct: 39.5, threshold_pct: 5 },
              history: { status: 'far', sample_count: 3, current_gain_pct: 31, target_gain_pct: 52, gap_pct: 21, historical_reach_pct: 66, sell_holding_pct: 25 },
              valuation: { status: 'high', percentile: 85, source: '持仓标的', current_pe: 40, average_pe: 30 },
              sentiment: { status: 'normal', score: 45 }, relative_strength_hot: true, recent_signals: [],
            },
          },
          exit_research: {
            symbol: 'MSFT', basis_symbol: 'MSFT', available_start: '2021-01-04', available_end: '2026-07-31',
            sample_count: 4, minimum_samples: 4, sample_sufficient: true,
            method: 'cycle', retained_holding_pct: 15,
            anchor: { low_date: '2026-06-25', low_price: 100, current_price: 140, current_gain_from_low_pct: 40, highest_gain_from_low_pct: 40 },
            stages: [
              { key: 'conservative', label: '保守兑现', quantile: 0.25, target_gain_pct: 52, historical_reach_pct: 75, median_days_to_target: 80, sell_holding_pct: 25, target_price_from_latest_low: 152, reached_now: false },
              { key: 'stretch', label: '乐观兑现', quantile: 0.75, target_gain_pct: 75, historical_reach_pct: 25, median_days_to_target: 160, sell_holding_pct: 25, target_price_from_latest_low: 175, reached_now: false },
            ],
          },
        },
        TQQQ: {
          family: 'TQQQ', market_value: 2000, held_symbols: ['TQQQ'], recent_signals: [],
          profit_gate: { unrealized_pnl_pct: 0.5 },
          decision: {
            verdict: 'WAIT', label: '再等等', notification_state: 'wait',
            reason: '未达最低止盈档', recommended_sell_pct: 0,
            evidence: {
              profit: { status: 'below_ladder', pnl_pct: 0.5, threshold_pct: 10 },
              history: { status: 'far', sample_count: 5, current_gain_pct: 12, target_gain_pct: 130, gap_pct: 118, historical_reach_pct: 80, sell_holding_pct: 25 },
              valuation: { status: 'normal', percentile: 22, source: '市场基准' },
              sentiment: { status: 'normal', score: 45 }, relative_strength_hot: false, recent_signals: [],
            },
          },
        },
      } },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(
      <SellDecisionDashboard snapshot={snapshot} holdings={[]} displayCurrency="USD" rates={rates} initialOpen />,
    );

    expect(html).toContain('卖出军令');
    expect(html).toContain('量化持仓实时计价');
    expect(html).toContain('每 20 分钟更新');
    expect(html).toContain('FUTU · 个股 · 盘中');
    expect(html).toContain('盈亏状态');
    expect(html).toContain('盈利');
    expect(html).not.toContain('当前盈利');
    expect(html).not.toContain('浮盈金额');
    expect(html).not.toContain('本轮涨幅');
    expect(html).not.toContain('成本价');
    expect(html).toContain('+$280.00');
    expect(html).toContain('+39.50%');
    expect(html).toContain('MSFT · 高估值减仓');
    expect(html).toContain('当前 TTM PE');
    expect(html).toContain('40.00');
    expect(html).toContain('5 年 PE 均值');
    expect(html).toContain('30.00');
    expect(html).toContain('第一令 · 卖出 $200.00');
    expect(html).toContain('当前执行参考价 MSFT $500.00（盘中）');
    expect(html).toContain('成交前在券商确认限价');
    expect(html).toContain('执行后预计剩余 $800.00');
    expect(html).toContain('第二令 · 卖出 $160.00');
    expect(html).toContain('执行后预计剩余 $640.00');
    expect(html).toContain('第三令 · 全部清仓 $640.00');
    expect(html).toContain('执行后预计剩余 $0.00');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('立即减仓 3%');
    expect(html).toContain('小样本，不参与军令');
    expect(html).toContain('执行序列');
  });

  it('shows only the current loss state instead of a conflicting positive cycle gain', () => {
    const snapshot = {
      generated_at: '2026-08-04T02:29:14-04:00',
      context: {},
      sell: { shadow: false, symbols: {
        GDX: {
          family: 'GDX', market_value: 5635.06, held_symbols: ['GDX'], recent_signals: [],
          positions: [{
            symbol: 'GDX', asset_type: 'etf', broker: 'IBKR', quantity: 74,
            contract_multiplier: 1, current_price: 76.15, price_session: 'pre',
            price_note: null, market_value: 5635.06, cost_basis: 6022.27, average_cost: 81.38,
            unrealized_pnl_usd: -387.21, unrealized_pnl_pct: -6.43,
          }],
          profit_gate: { unrealized_pnl_usd: -387.21, unrealized_pnl_pct: -6.43 },
          decision: {
            verdict: 'WAIT', label: '再等等', notification_state: 'wait',
            reason: '当前浮亏 -6.43%，先等等', recommended_sell_pct: 0,
            evidence: {
              profit: { status: 'loss', pnl_pct: -6.43, threshold_pct: 5 },
              history: { status: 'far', sample_count: 4, current_gain_pct: 3.78, target_gain_pct: 125.08, gap_pct: 121.3, historical_reach_pct: 25, sell_holding_pct: 20 },
              valuation: { status: 'missing', percentile: null, source: '暂无' },
              sentiment: { status: 'normal', score: 46 }, relative_strength_hot: false, recent_signals: [],
            },
          },
        },
      } },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(
      <SellDecisionDashboard snapshot={snapshot} holdings={[]} displayCurrency="USD" rates={rates} />,
    );

    expect(html).toContain('盈亏状态');
    expect(html).toContain('亏损');
    expect(html).toContain('-$387.21');
    expect(html).toContain('-6.43%');
    expect(html).toContain('当前浮亏 -6.43%');
    expect(html).not.toContain('本轮涨幅');
    expect(html).not.toContain('+3.78%');
    expect(html).not.toContain('成本价');
  });
});

describe('零碎持仓不进卖出军令', () => {
  const dustSnapshot = (() => {
    const snapshot = structuredClone(synchronizedSnapshot) as unknown as QuantAnalysisSnapshot;
    snapshot.sell!.symbols.NVDA.market_value = 1.09;
    snapshot.sell!.symbols.NVDA.sell_price_plan = {
      method: 'recovery_valuation', available: true, status: 'waiting', quality: 'current_estimate',
      sell_price: 337.73, trigger_price: 337.73, current_price: 218, basis_current_price: 218,
      action_stage_key: 'trim_stock', stages: [],
    } as never;
    return snapshot;
  })();

  it('市值只剩 $1.09 的族不出现在卖出军令和卖出价格清单里', () => {
    const html = renderToStaticMarkup(
      <SellDecisionDashboard snapshot={dustSnapshot} holdings={[]} displayCurrency="USD" rates={rates} />,
    );

    expect(html).not.toContain('>NVDA<');
    expect(html).not.toContain('$337.73');
    expect(html).toContain('>MSFT<');
  });
});

describe('离谱的卖出线不显示', () => {
  const tslaSnapshot = (() => {
    const snapshot = structuredClone(synchronizedSnapshot) as unknown as QuantAnalysisSnapshot;
    const family = snapshot.sell!.symbols.NVDA;
    family.family = 'TSLA';
    family.held_symbols = ['TSLA'];
    family.market_value = 8_445.12;
    family.sell_price_plan = {
      method: 'recovery_valuation', available: true, status: 'reached', quality: 'current_estimate',
      basis_symbol: 'TSLA', current_price: 367.16, basis_current_price: 367.16,
      current_forward_pe: 355.53, sell_price: 30.98, trigger_price: 30.98, clear_price: 33.05,
      action_stage_key: 'reduce_risk', active_stage: 'trim_stock',
      stages: [
        { key: 'clear_derivatives', label: '清理衍生仓', trigger_price: 33.05, trigger_kind: 'forward_valuation', reached: true, action: 'a' },
        { key: 'trim_stock', label: '正股分批减仓', trigger_price: 30.98, trigger_kind: 'forward_valuation', reached: true, action: 'b' },
      ],
    } as never;
    delete (snapshot.sell!.symbols as Record<string, unknown>).MSFT;
    snapshot.sell!.symbols.TSLA = family;
    delete (snapshot.sell!.symbols as Record<string, unknown>).NVDA;
    return snapshot;
  })();

  it('TSLA 现价 $367 时不显示 $30.98 的卖出线，改用现有的「暂时无法测算」', () => {
    const html = renderToStaticMarkup(
      <SellDecisionDashboard snapshot={tslaSnapshot} holdings={[]} displayCurrency="USD" rates={rates} />,
    );

    expect(html).not.toContain('$30.98');
    expect(html).not.toContain('$33.05');
    expect(html).toContain('暂时无法测算');
    expect(html).toContain('>TSLA<');
  });
});
