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
  regime_status: {
    available: true,
    evaluated_at: '2026-07-26T07:06:13-04:00',
    current: {
      pe: 30.1128,
      pe_percentile_5y: 47.08,
      pe_bucket_index: 2,
      pe_bucket: '40-60%',
      cnn_score: 39.43,
      cnn_bucket_index: 2,
      cnn_bucket: '35-55（中性）',
      regime_label: '估值中性 · 情绪中性',
    },
    grid: [[{
      pe_bucket_index: 2,
      cnn_bucket_index: 2,
      pe_bucket: '40-60%',
      cnn_bucket: '35-55（中性）',
      n: 21,
      reference_benchmark: 'QQQ',
      reference_horizon_days: 60,
      reference: {
        horizon_trading_days: 60,
        n: 10,
        win_rate_pct: 100,
        mean_return_pct: 12.94,
        median_return_pct: 13.6,
        worst_return_pct: 4.68,
        sample_sufficient: false,
        sample_warning: '样本不足（n=10，需 ≥30）；联合历史不足 500 天；缺少完整熊市样本',
        insufficient_reason: '样本不足（n=10，需 ≥30）',
        horizon_conflict: true,
        horizon_conflict_gap_pct: 68.75,
        horizon_conflict_note: '20日与60日观察相差 68.75 个百分点，期限结论互相冲突',
      },
    }]],
    divergence: {
      detected: false,
      direction: null,
      expected_cnn_median: 55.17,
      cnn_q1: 41.36,
      cnn_q3: 59.87,
      cnn_iqr: 18.51,
      actual_cnn: 39.43,
      note: '当前 CNN 位于该估值分位的历史常态区间',
      historical_occurrences: 0,
      no_reference: true,
      reference_note: '该背离在可用历史中未出现过，无任何统计参考',
      sample_sufficient: false,
      sample_warning: '样本不足（n=0），仅供参考，不构成统计结论',
      win_rates: {},
    },
    win_rates: {
      QQQ: {
        '20': {
          horizon_trading_days: 20,
          n: 16,
          win_rate_pct: null,
          mean_return_pct: -0.2,
          median_return_pct: -1.1,
          worst_return_pct: -5.91,
          sample_sufficient: false,
          sample_warning: '样本不足（n=16，需 ≥30）',
          insufficient_reason: '样本不足（n=16，需 ≥30）',
          horizon_conflict: true,
          horizon_conflict_gap_pct: 68.75,
          horizon_conflict_note: '20日与60日观察相差 68.75 个百分点，期限结论互相冲突',
        },
      },
      TQQQ: {
        '120': {
          horizon_trading_days: 120,
          n: 3,
          win_rate_pct: 100,
          mean_return_pct: 15.1,
          median_return_pct: 11.88,
          worst_return_pct: 8.21,
          sample_sufficient: false,
          sample_warning: '样本不足（n=3），仅供参考，不构成统计结论',
        },
      },
    },
    position_advice: {
      current_risk_position_pct: 64.18,
      matrix_target_pct: 50,
      divergence_adjusted_target_pct: 50,
      suggested_total_pct: 54.18,
      basis: 'matrix_only',
      gap_pct: -10,
      gap_usd: -14044.91,
      action_text: '当前风险仓位高于本状态参考区间，保持克制并分步评估',
      divergence_note: null,
      capped_by_max_step: true,
      max_step_pct: 10,
      position_gate: { passed: false, note: '现有仓位门未通过' },
      scope_note: '建议总仓位，不是单笔金额',
      disclaimer: '统计参考，不构成投资建议或交易指令',
    },
    data_quality: {
      joint_sample_days: 248,
      joint_start: '2025-07-28',
      joint_end: '2026-07-24',
      raw_pe_observations: 156,
      raw_cnn_observations: 248,
      pe_interpolated: true,
      cnn_history_span: '近1年公开历史上限',
      caveat: 'CNN 公开历史约1年，联合样本有限；PE 插值不等于原始日频观测',
      joint_span_days: 361,
      bear_sample_included: false,
      conclusion_allowed: false,
      insufficient_reason: '联合历史不足 500 天；缺少完整熊市样本',
      regime_bias: 'bull_only',
      qqq_span_return_pct: 21.01,
      qqq_span_max_drawdown_pct: -11.96,
      headline_caveat: '联合历史仅覆盖单边上涨区间，缺少完整熊市样本；本页胜率不具备统计结论条件',
    },
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
    expect(html).toContain('估值中性 · 情绪中性');
    expect(html).toContain('5×5 状态定位');
    expect(html).toContain('状态格详情');
    expect(html).toContain('40-60% × 35-55（中性）');
    expect(html).toContain('QQQ / TQQQ 历史胜率');
    expect(html).toContain('建议总仓位，不是单笔金额');
    expect(html).toContain('样本不足（n=3），仅供参考，不构成统计结论');
    expect(html).toContain('联合历史仅覆盖单边上涨区间');
    expect(html).toContain('行 = 估值高低（PE 分位），列 = 市场情绪（CNN）');
    expect(html).toContain('样本不足（n=10，需 ≥30）');
    expect(html).toContain('期限结论互相冲突');
    expect(html).not.toContain('100.00%');
  });

  it('degrades honestly when the backend fields are not ready', () => {
    const html = renderToStaticMarkup(
      <ValuationPanel snapshot={{ ...snapshot, valuation_tab: undefined, buy_plan_status: undefined }} onDirtyChange={() => undefined} />,
    );

    expect(html).toContain('数据准备中');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
  });

  it('shows a calm unavailable state without inventing regime evidence', () => {
    const html = renderToStaticMarkup(
      <ValuationPanel
        snapshot={{
          ...snapshot,
          regime_status: {
            available: false,
            reason: '联合历史暂不可用',
          },
        }}
        onDirtyChange={() => undefined}
      />,
    );

    expect(html).toContain('联合历史准备中');
    expect(html).toContain('联合历史暂不可用');
    expect(html).not.toContain('NaN');
  });
});
