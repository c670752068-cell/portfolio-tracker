import { describe, expect, it } from 'vitest';
import {
  BUY_PLAN_TEMPLATES,
  alignValuationHistoryAsOf,
  buildValuationSummary,
  evaluateLocalBuyPlan,
  planToYaml,
  validateLocalBuyPlan,
} from './valuationPlan';
import type { QuantAnalysisSnapshot } from './types';

const snapshot = {
  source: 'futu-assistant',
  generated_at: '2026-07-26T07:06:13-04:00',
  rule_version: '2.2',
  disclaimer: '仅作信息展示',
  context: {},
  symbols: {
    TQQQ: {
      available: true,
      gates: {
        low_zone: { passed: true, current_drawdown_pct: -27.18 },
      },
    },
  },
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
      history: [],
      source: 'danjuanfunds',
      as_of: '2026-07-24',
      realtime_estimate: {
        pe: 29.8,
        basis: 'QQQ 最新价 ÷ 日更收盘价 × 丹居日更 PE',
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
      history: [],
      source: 'cnn',
      as_of: '2026-07-25',
    },
    anchors: [],
    distance_to_anchors: [],
  },
  buy_plan_status: {
    evaluated_at: '2026-07-26T07:06:13-04:00',
    plans: [],
  },
} satisfies QuantAnalysisSnapshot;

describe('valuation plan helpers', () => {
  it('aligns a stale final history point to the valuation as-of date', () => {
    const history = [
      { date: '2026-07-16', pe: 31.2, pb: 9.4 },
      { date: '2026-07-23', pe: 30.1128, pb: 9.2752 },
    ];

    expect(alignValuationHistoryAsOf(
      history,
      '2026-07-24',
      30.1128,
      9.2752,
    )).toEqual([
      history[0],
      { date: '2026-07-24', pe: 30.1128, pb: 9.2752 },
    ]);
  });

  it('evaluates all configured conditions as AND and uses the realtime PE estimate', () => {
    const plan = {
      id: 'tqqq-stage-1',
      symbol: 'TQQQ',
      label: '第一枪·试探',
      ndxPeBelow: 30,
      cnnScoreBelow: 30,
      drawdownBelowPct: -25,
      buyPctOfNav: 3,
      enabled: true,
    };

    const result = evaluateLocalBuyPlan(plan, snapshot);

    expect(result.conditions.map((item) => item.met)).toEqual([true, false, true]);
    expect(result.met_count).toBe(2);
    expect(result.conditions_ready).toBe(false);
    expect(result.ready).toBe(false);
  });

  it('creates a calm top summary and switches to the anti-anxiety copy at CNN 20', () => {
    expect(buildValuationSummary(snapshot)).toContain('估值已到位');
    expect(buildValuationSummary(snapshot)).toContain('情绪还没砸');
    expect(buildValuationSummary({
      ...snapshot,
      valuation_tab: {
        ...snapshot.valuation_tab!,
        cnn: { ...snapshot.valuation_tab!.cnn, current_score: 20 },
      },
    })).toContain('这正是你计划里要开枪的时候');
  });

  it('provides the three approved templates and validates the 20% position ceiling', () => {
    expect(BUY_PLAN_TEMPLATES.map((item) => item.label)).toEqual(['试探仓', '加码仓', '梭哈仓']);
    expect(validateLocalBuyPlan({ ...BUY_PLAN_TEMPLATES[0].values, symbol: 'TQQQ', id: 'x', label: 'x' })).toEqual([]);
    expect(validateLocalBuyPlan({ ...BUY_PLAN_TEMPLATES[0].values, symbol: 'TQQQ', id: 'x', label: 'x', buyPctOfNav: 21 })).toContain('买入占净值必须大于 0 且不超过 20%');
  });

  it('generates paste-ready strict YAML without inventing unsupported fields', () => {
    const yaml = planToYaml([{
      id: 'tqqq-stage-1',
      symbol: 'TQQQ',
      label: '第一枪·试探',
      ndxPeBelow: 30,
      cnnScoreBelow: 30,
      drawdownBelowPct: -25,
      buyPctOfNav: 3,
      enabled: true,
    }]);

    expect(yaml).toContain('version: 1');
    expect(yaml).toContain('ndx_pe_below: 30');
    expect(yaml).toContain('buy_pct_of_nav: 3');
    expect(yaml).not.toContain('undefined');
  });
});
