export const quantAnalysisFixture = {
  source: 'futu-assistant',
  generated_at: '2026-07-15T10:00:00-04:00',
  rule_version: '2.2',
  disclaimer: '认知参考，禁止据此机械调参；历史统计不代表未来收益',
  context: {
    cnn_fear_greed: { score: 46.3, rating: 'neutral', available: true },
    ndx_valuation: { pe: 36.08, pe_percentile_5y: 83.12, zone: '偏高', available: true },
    soxx: { percentile: 98.71, method: 'price_ma_fallback', available: true },
    rebound: { base_date: '2026-03-30', status: 'repairing', available: true },
  },
  symbols: {
    SOXL: {
      available: true,
      gates: {
        low_zone: { passed: true, current_drawdown_pct: -63.29, threshold_pct: -28 },
        signal_triggered: {
          passed: false,
          recent_buy_signals: [{ name: 'near_prior_low', label: '接近前低', date: '2026-07-15' }],
        },
        position_gate: { passed: true, family_share_pct: 3.2, cap_pct: 8 },
        daily_fuse: { passed: true, buys_today: 0, max_new_buys: 2 },
        batch_available: { passed: true, next_batch: 2, batch_count: 3 },
        valuation: {
          passed: false,
          available: true,
          reason: 'SOXX 分位 98.7 高估',
          cnn: 46.3,
          ndx_percentile: 83.1,
          soxx_percentile: 98.7,
          stock_percentile: null,
        },
      },
      gates_passed: 4,
      gates_total: 6,
      signal_stats: {
        near_prior_low: {
          d5: { n: 19, win_rate: null, sample_insufficient: true },
          d20: { n: 20, win_rate: 0.55, sample_insufficient: false },
          d60: { n: 25, win_rate: 0.6, sample_insufficient: false },
        },
      },
      depth_stats: {
        level_pct: 60,
        win_rate_60d: null,
        n: 10,
        sample_insufficient: true,
        bear_included: true,
      },
    },
  },
  holding_costs: {
    SOXL: {
      weighted_average_cost: 22.5,
      currency: 'USD',
      coverage: 'complete',
      auto_fill_allowed: true,
    },
  },
} as const;
