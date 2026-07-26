import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { QuantAnalysisSnapshot } from '../types';
import { ValuationPanel } from './ValuationPanel';

const snapshot = {
  source: 'futu-assistant',
  generated_at: '2026-07-26T07:06:13-04:00',
  rule_version: '2.2',
  disclaimer: '仅作信息展示',
  context: {},
  symbols: { TQQQ: { available: true, gates: { low_zone: { passed: true, current_drawdown_pct: -27.18 } } } },
  valuation_tab: {
    available: true,
    generated_at: '2026-07-26T07:06:13-04:00',
    ndx: {
      available: true,
      current_pe: 30.1128,
      current_pb: 9.2752,
      pe_percentile_5y: 47.08,
      zone: '适中',
      percentile_lines: { p30: 34.2191, median: 35.1763, p70: 36.1534 },
      history: [
        { date: '2025-04-06', pe: 28.3553, pb: 8.1 },
        { date: '2026-07-24', pe: 30.1128, pb: 9.2752 },
      ],
      source: 'danjuanfunds',
      as_of: '2026-07-24',
      realtime_estimate: {
        pe: 29.8,
        basis: 'QQQ 最新价 680 ÷ 日更收盘价 684 × 丹居日更 PE',
        qqq_price: 680,
        daily_qqq_close: 684,
        price_session: 'pre',
        estimated_at: '2026-07-26T07:06:13-04:00',
        note: '估算值；盈利基数按季度更新，日内视为不变',
      },
    },
    cnn: {
      available: true,
      current_score: 39.43,
      rating: 'fear',
      history: [{ date: '2026-07-25', score: 39.43 }],
      source: 'cnn',
      as_of: '2026-07-25',
    },
    anchors: [{ label: '2025-04 关税恐慌低点', date: '2025-04-06', ndx_pe: 28.3553 }],
    distance_to_anchors: [{
      label: '2025-04 关税恐慌低点',
      target_pe: 28.3553,
      current_pe: 30.1128,
      pe_gap_pct: -5.836389,
      implied_qqq_price: 644.295679,
      current_qqq_price: 684.23,
      price_gap_pct: -5.836389,
      estimate_note: '按当前盈利基数估算',
    }],
  },
  buy_plan_status: {
    evaluated_at: '2026-07-26T07:06:13-04:00',
    plans: [{
      id: 'tqqq_stage1',
      symbol: 'TQQQ',
      label: '第一枪·试探',
      enabled: true,
      ready: false,
      conditions_ready: false,
      conditions: [
        { key: 'ndx_pe_below', name: 'NDX PE < 30', target: 30, current: 30.1128, met: false, gap_text: '还差 0.4%' },
        { key: 'cnn_score_below', name: 'CNN < 30', target: 30, current: 39.43, met: false, gap_text: '还差 9.4 点' },
        { key: 'drawdown_below_pct', name: '回撤 < -25%', target: -25, current: -27.18, met: true, gap_text: '已满足' },
      ],
      met_count: 1,
      total_count: 3,
      action_text: '买入账户净值 3%',
      action_amount_usd: 3050,
      buy_pct_of_nav: 3,
      position_gate: { passed: true, note: 'TQQQ 族当前 7.0%/上限 10.0%' },
    }],
  },
} satisfies QuantAnalysisSnapshot;

describe('ValuationPanel', () => {
  it('renders all five evidence sections, estimates, progress and timestamps', () => {
    const html = renderToStaticMarkup(
      <ValuationPanel snapshot={snapshot} onDirtyChange={() => undefined} />,
    );

    expect(html).toContain('估值已到位');
    expect(html).toContain('纳指100 估值');
    expect(html).toContain('市场情绪');
    expect(html).toContain('三年 PE 走势');
    expect(html).toContain('CNN 恐慌贪婪 · 近1年');
    expect(html).toContain('还差多少');
    expect(html).toContain('按当前盈利基数估算');
    expect(html).toContain('开枪计划表');
    expect(html).toContain('1/3 条件满足');
    expect(html).toContain('量化快照');
    expect(html).toContain('生成 YAML');
  });

  it('degrades honestly when the backend fields are not ready', () => {
    const html = renderToStaticMarkup(
      <ValuationPanel snapshot={{ ...snapshot, valuation_tab: undefined, buy_plan_status: undefined }} onDirtyChange={() => undefined} />,
    );

    expect(html).toContain('数据准备中');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
  });
});
