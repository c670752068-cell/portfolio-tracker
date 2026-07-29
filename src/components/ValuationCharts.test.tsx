import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { QuantForwardPeHistory, QuantValuationTab } from '../types';
import { ValuationCharts } from './ValuationCharts';

const valuation: QuantValuationTab = {
  available: true,
  generated_at: '2026-07-29T09:30:00-04:00',
  ndx: {
    available: true,
    current_pe: 30.022,
    current_pb: null,
    pe_percentile_5y: 22.09,
    zone: '偏低',
    percentile_lines: { p30: 32.46, median: 34.15, p70: 35.37 },
    history: [
      { date: '2021-07-29', pe: 30.5, pb: null },
      { date: '2026-07-29', pe: 30.022, pb: null },
    ],
    source: 'Danjuan/Xueqiu',
    as_of: '2026-07-29',
    stale: true,
    stale_days: 5,
    realtime_estimate: null,
  },
  cnn: { available: true, current_score: 40, rating: 'fear', history: [], source: 'CNN', as_of: '2026-07-29' },
  anchors: [],
  distance_to_anchors: [],
};

const forward: QuantForwardPeHistory = {
  generated_at: '2026-07-29T09:30:00-04:00',
  metric: 'forward_pe',
  frequency: 'daily',
  method: 'top_n_mktcap_weighted_yahoo_forward_eps',
  approximation_note: '前30大成分市值加权近似，非官方指数权重，与 Bloomberg BEst 1BF 会有偏差',
  history_ready: false,
  history_days: 1,
  history_days_required: 60,
  symbols: {
    NDX: {
      current: 23.21,
      percentile: null,
      percentile_unavailable_reason: '历史积累中 1/60 个交易日',
      series: [{ date: '2026-07-29', value: 23.21 }],
      series_start: '2026-07-29',
      series_end: '2026-07-29',
      constituents_used: 30,
      constituents_excluded: 0,
      weight_coverage_pct: 100,
    },
  },
};

describe('ValuationCharts', () => {
  it('uses the actual TTM span and marks stale valuation data', () => {
    const html = renderToStaticMarkup(<ValuationCharts valuation={valuation} forwardHistory={forward} />);

    expect(html).toContain('5 年 PE 走势');
    expect(html).toContain('⚠ 数据停留在 2026-07-29（5 天前）');
    expect(html).toContain('TTM');
    expect(html).toContain('远期');
  });

  it('renders the honest accumulation state for forward PE without a percentile', () => {
    const html = renderToStaticMarkup(<ValuationCharts valuation={valuation} forwardHistory={forward} initialMetric="forward" />);

    expect(html).toContain('远期 PE（积累中）');
    expect(html).toContain('历史积累中 1/60 个交易日');
    expect(html).toContain('前30大成分市值加权近似');
    expect(html).not.toContain('远期分位');
  });
});
