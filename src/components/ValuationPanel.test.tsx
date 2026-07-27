import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { QuantAnalysisSnapshot } from '../types';
import { ValuationPanel } from './ValuationPanel';

const snapshot = {
  source: 'futu-assistant',
  generated_at: '2026-07-26T07:06:13-04:00',
  rule_version: '2.2',
  disclaimer: '仅作信息展示',
  context: {
    vix: {
      available: true,
      value: 18.58,
      as_of: '2026-07-24',
      percentile: 68.254,
      percentile_window_days: 252,
      zone: 'normal',
      zone_label: '常态波动',
      position_adjustment_pct: 0,
      policy: 'adjustment_only',
      is_proxy: false,
      source: { provider: 'Cboe', kind: 'official_daily_close', is_proxy: false },
      term_structure: { available: false, reason: '免费可靠的 VIX 期限结构数据暂不可用，未生成倒挂信号' },
    },
  },
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
    axes: {
      row: 'drawdown_from_high',
      column: 'vix_percentile_1y',
    },
    current: {
      primary: {
        symbol: 'QQQ',
        drawdown_pct: -8.2,
        vix_value: 18.58,
        vix_percentile_1y: 68.25,
        vix_is_proxy: false,
        row_bucket_index: 2,
        row_bucket: '-12~-6%',
        col_bucket_index: 3,
        col_bucket: '60-80%',
        cell_label: '中度回撤 × 波动偏高',
      },
      overlay: {
        overlay_available: true,
        participates_in_grid: false,
        pe: 30.1128,
        pe_percentile_5y: 47.08,
        pe_zone: '估值中性',
        cnn_score: 39.43,
        cnn_rating: '35-55（中性）',
        overlay_note: '估值中性、情绪中性（叠加层，因历史仅约1年不参与建格）',
      },
      cell_stats: {},
    },
    current_cell: {
      row_index: 2, col_index: 3, row_label: '-12~-6%', col_label: '60-80%', row_value: -8.2, col_value: 68.25,
      row_basis: 'QQQ 自120 日高点回撤', col_basis: 'VIX 近 1 年分位', as_of: '2026-07-26T07:06:13-04:00', price_session: 'closed', n: 66, bear_included: true,
      statistics: {
        QQQ: {
          '20': { horizon_trading_days: 20, n: 66, win_rate_pct: 60.61, mean_return_pct: 2.38, median_return_pct: 2.38, worst_return_pct: -13.6, sample_sufficient: true, sample_warning: null },
          '60': { horizon_trading_days: 60, n: 66, win_rate_pct: 81.82, mean_return_pct: 8.45, median_return_pct: 8.45, worst_return_pct: -23.97, sample_sufficient: true, sample_warning: null },
          '120': { horizon_trading_days: 120, n: 66, win_rate_pct: 83.33, mean_return_pct: 15.5, median_return_pct: 15.5, worst_return_pct: -23.7, sample_sufficient: true, sample_warning: null },
        },
      },
    },
    verdict_card: {
      headline: '中度回撤 × 波动偏高 —— 历史 60 日胜率 81.82%', cell_label: '回撤 -8.20% × VIX 分位 68.25%', sample_sufficient: true, bear_included: true,
      sample_context: '样本 n=66 · 已包含 2020/2022/2025 下跌时段', primary: { horizon_days: 60, win_rate_pct: 81.82, median_return_pct: 8.45, worst_return_pct: -23.97, n: 66 },
      horizons: { '20': { win_rate_pct: 60.61, median_return_pct: 2.38, worst_return_pct: -13.6, n: 66 }, '60': { win_rate_pct: 81.82, median_return_pct: 8.45, worst_return_pct: -23.97, n: 66 }, '120': { win_rate_pct: 83.33, median_return_pct: 15.5, worst_return_pct: -23.7, n: 66 } },
      leveraged: { symbol: 'TQQQ', '60': { win_rate_pct: 80.3, median_return_pct: 21.79, worst_return_pct: -60.9, n: 66 } }, overlay_note: '叠加层：估值 PE 分位 47% · 情绪 CNN 39（历史仅约1年，仅供参考）', action_hint: '历史统计仅供参考，请与既有买入计划和仓位纪律一同查看', caveats: ['历史统计不代表未来收益', '最差情形 QQQ -23.97% / TQQQ -60.90%，需能承受'], plan_link: { ready_count: 0, total_count: 3, nearest: { label: '第一枪·试探', missing: ['CNN < 30（当前 39.4）'] } },
    },
    grid: [[{
      row_bucket_index: 2,
      col_bucket_index: 3,
      row_bucket: '-12~-6%',
      col_bucket: '60-80%',
      n: 70,
      bear_included: true,
      reference_benchmark: 'QQQ',
      reference_horizon_days: 60,
      reference: {
        horizon_trading_days: 60,
        n: 66,
        win_rate_pct: 81.82,
        mean_return_pct: 6.06,
        median_return_pct: 8.45,
        worst_return_pct: -23.97,
        sample_sufficient: true,
        sample_warning: null,
        insufficient_reason: null,
        bear_included: true,
        horizon_conflict: false,
        horizon_conflict_gap_pct: null,
        horizon_conflict_note: null,
      },
      statistics: {},
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
      matrix_target_pct: 60,
      overlay_adjusted_target_pct: 60,
      overlay_adjustment_pct: 0,
      vix_adjusted_target_pct: 60,
      vix_adjustment_pct: 0,
      suggested_total_pct: 60,
      basis: 'matrix_and_winrate',
      gap_pct: -4.18,
      gap_usd: -5869.77,
      action_text: '当前风险仓位高于本状态参考区间，保持克制并分步评估',
      overlay_note: null,
      capped_by_max_step: true,
      max_step_pct: 10,
      position_gate: { passed: false, note: '现有仓位门未通过' },
      scope_note: '建议总仓位，不是单笔金额',
      disclaimer: '统计参考，不构成投资建议或交易指令',
    },
    data_quality: {
      grid_sample_days: 2151,
      grid_start: '2018-01-02',
      grid_end: '2026-07-24',
      vix_observations: 2151,
      is_proxy: false,
      vix_source: { provider: 'Cboe', kind: 'official_daily_close', is_proxy: false },
      joint_span_days: 3125,
      joint_span_start: '2018-01-02',
      joint_span_end: '2026-07-24',
      bear_sample_included: true,
      conclusion_allowed: true,
      insufficient_reason: null,
      regime_bias: 'mixed_or_unclear',
      qqq_span_return_pct: 357.97,
      qqq_span_max_drawdown_pct: -35.12,
      headline_caveat: null,
      caveat: '状态格仅使用 QQQ 回撤与 VIX 分位长历史；PE/CNN 仅作当前叠加说明，不参与建格',
    },
    headline: '中度回撤 × 波动偏高 × 估值中性 —— 该格历史 60 日胜率 81.82%（n=66，含熊市样本）。',
    legacy_pe_cnn_grid: {
      deprecated: true,
      display: false,
      reason: 'CNN 公开历史仅约1年，不再作为状态格主轴',
    },
  },
  vix_study: {
    source: { provider: 'Cboe', kind: 'official_daily_close', is_proxy: false },
    sample: { start: '2018-01-02', end: '2026-07-24', trading_days: 2151 },
    persistence: {
      ge_30: { threshold: 30, episode_count: 28, median_trading_days: 2.5, mean_trading_days: 5.5, max_trading_days: 50 },
      ge_40: { threshold: 40, episode_count: 8, median_trading_days: 1.5, mean_trading_days: 4.875, max_trading_days: 26 },
    },
    buckets: {
      '25-30': {
        '60': { horizon_trading_days: 60, n: 211, win_rate_pct: 71.09, observed_win_rate_pct: 71.09, average_return_pct: 7.09, median_return_pct: 8.1, sample_sufficient: true, insufficient_reason: null },
      },
      ge40: {
        '60': { horizon_trading_days: 60, n: 39, win_rate_pct: 100, observed_win_rate_pct: 100, average_return_pct: 21.5, median_return_pct: 20, sample_sufficient: true, insufficient_reason: null },
      },
    },
    fine_buckets: {},
    by_regime: {},
    regime_concentration: {
      bucket: 'ge40',
      horizon_trading_days: 60,
      counts: { 疫情崩盘: 33, 关税震荡: 4 },
      top_regime: '疫情崩盘',
      top_regime_share_pct: 84.6154,
      concentrated: true,
      warning: '高胜率样本中 84.6% 集中于「疫情崩盘」，不可外推为普遍规律。',
    },
    headline: '真实 VIX 复核：极端样本集中于疫情崩盘。',
    limitations: ['历史统计不代表未来收益', 'VIX 已是 CNN 情绪指数的组成项之一'],
    generated_at: '2026-07-26T13:23:39-04:00',
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
    expect(html).toContain('VIX 波动率');
    expect(html).toContain('VIX 18.58');
    expect(html).toContain('252日分位 68.25%');
    expect(html).toContain('波动率与胜率研究');
    expect(html).toContain('集中于「疫情崩盘」');
    expect(html).toContain('历史统计不代表未来收益');
    expect(html).toContain('三年 PE 走势');
    expect(html).toContain('CNN 恐慌贪婪 · 近1年');
    expect(html).toContain('还差多少');
    expect(html).toContain('按当前盈利基数估算');
    expect(html).toContain('开枪计划表');
    expect(html).toContain('1/3 条件满足');
    expect(html).toContain('量化快照');
    expect(html).toContain('生成 YAML');
    expect(html).toContain('中度回撤 × 波动偏高');
    expect(html).toContain('当前状态');
    expect(html).toContain('最差情形');
    expect(html).toContain('查看完整状态矩阵');
    expect(html).toContain('回撤 -8.20% × VIX 分位 68.25%');
    expect(html).not.toContain('熊市样本');
    expect(html).not.toContain('QQQ / TQQQ 历史胜率');
    expect(html).toContain('建议总仓位，不是单笔金额');
    expect(html).toContain('当前状态已在上方结论卡显示');
    expect(html).not.toContain('行 = 估值高低（PE 分位）');
  });

  it('degrades honestly when the backend fields are not ready', () => {
    const html = renderToStaticMarkup(
      <ValuationPanel snapshot={{ ...snapshot, valuation_tab: undefined, buy_plan_status: undefined }} onDirtyChange={() => undefined} />,
    );

    expect(html).toContain('数据准备中');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
  });

  it('labels proxy VIX data and suppresses all insufficient research statistics', () => {
    const html = renderToStaticMarkup(
      <ValuationPanel
        snapshot={{
          ...snapshot,
          context: {
            vix: {
              ...snapshot.context.vix,
              is_proxy: true,
              source: { provider: 'local', kind: 'rv20_proxy', is_proxy: true },
            },
          },
          vix_study: {
            ...snapshot.vix_study!,
            source: { provider: 'local', kind: 'rv20_proxy', is_proxy: true },
            buckets: {
              ge40: {
                '60': {
                  horizon_trading_days: 60,
                  n: 5,
                  win_rate_pct: null,
                  observed_win_rate_pct: 100,
                  average_return_pct: 42,
                  median_return_pct: 40,
                  sample_sufficient: false,
                  insufficient_reason: '样本不足',
                },
              },
            },
          },
        }}
        onDirtyChange={() => undefined}
      />,
    );

    expect(html).toContain('RV20 代理，非真实 VIX');
    expect(html).toContain('样本不足 · n=5');
    expect(html).not.toContain('+42.00%');
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

    expect(html).toContain('当前状态准备中');
    expect(html).toContain('联合历史暂不可用');
    expect(html).not.toContain('NaN');
  });

  it('withholds all verdict statistics when the backend marks the current cell insufficient', () => {
    const verdict = snapshot.regime_status!.verdict_card!;
    const html = renderToStaticMarkup(
      <ValuationPanel
        snapshot={{
          ...snapshot,
          regime_status: {
            ...snapshot.regime_status!,
            verdict_card: {
              ...verdict,
              sample_sufficient: false,
              headline: '当前状态的历史样本不足，暂不展示胜率结论。',
              sample_context: '样本不足（n=8，需≥30），不构成统计结论。',
              primary: { horizon_days: null, win_rate_pct: null, median_return_pct: null, worst_return_pct: null, n: null },
              horizons: { '20': null, '60': null, '120': null },
            },
          },
        }}
        onDirtyChange={() => undefined}
      />,
    );

    expect(html).toContain('无统计结论');
    expect(html).not.toContain('TQQQ 同状态 60 日');
    expect(html).not.toContain('⚠ 最差情形');
  });
});
