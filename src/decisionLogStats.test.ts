import { describe, expect, it } from 'vitest';
import { buildDecisionStats, MIN_RELIABLE_SAMPLES, NO_SKILL_BASELINE } from './decisionLogStats';
import type { DecisionPrediction, DecisionTrade, DecisionTradeStatus } from './decisionLog';

function trade(
  id: string, prediction: DecisionPrediction | null, status: DecisionTradeStatus,
  extra: Partial<DecisionTrade> = {},
): DecisionTrade {
  return {
    id, trade_time: '2026-09-01T14:30:00Z', recorded_by: 'manual', symbol: 'TQQQ', side: 'SELL',
    asset_type: null, broker: null, qty: 100, price: 80, amount: 8_000, price_source: 'manual',
    price_estimated: false, trigger: [], prediction, note: '', status,
    resolved_at: null, resolved_price: null, result_pct: null, qqq_result_pct: null, vs_hold_pct: null,
    indicators: {
      qqq_drawdown_pct: null, symbol_drawdown_pct: null, z_score: null, z_score_as_of: null,
      ma200_slope_pct: null, sma_slope_pct: null, ttm_pe: null, ttm_pe_percentile: null,
      cnn_fear_greed: null, vix: null, ndx_pe: null,
    },
    ...extra,
  };
}

const dip5 = (): DecisionPrediction => ({ type: 'rebuy_after_dip', dip_pct: 5, reference_symbol: 'QQQ' });
const dip10 = (): DecisionPrediction => ({ type: 'rebuy_after_dip', dip_pct: 10, reference_symbol: 'QQQ' });

describe('命中率统计', () => {
  it('基准来自回测：回调 5% 接回 50%，回调 10% 接回 62%；10 笔以下不可靠', () => {
    expect(NO_SKILL_BASELINE).toEqual({ dip5: 0.5, dip10: 0.62 });
    expect(MIN_RELIABLE_SAMPLES).toBe(10);
  });

  it('按预判类型分组，算命中率并和基准比', () => {
    const trades = [
      ...Array.from({ length: 6 }, (_, index) => trade(`hit-${index}`, dip5(), 'hit', { vs_hold_pct: 12, amount: 10_000 })),
      ...Array.from({ length: 4 }, (_, index) => trade(`miss-${index}`, dip5(), 'miss', { vs_hold_pct: -46, amount: 10_000 })),
      trade('pending', dip5(), 'in_progress'),
      trade('note', null, 'pending_note'),
    ];

    const { groups, pendingNotes } = buildDecisionStats(trades);
    const group = groups.find((item) => item.key === 'rebuy_after_dip_5')!;

    expect(pendingNotes).toBe(1);
    expect(group).toMatchObject({
      label: '卖出后等回调 5% 接回', samples: 10, hits: 6, pending: 1, baseline: 0.5, reliable: true,
    });
    expect(group.hitRate).toBeCloseTo(0.6, 6);
    expect(group.baselineGapPp).toBeCloseTo(10, 6);
    expect(group.avgVsHoldPct).toBeCloseTo((6 * 12 + 4 * -46) / 10, 6);
    expect(group.cumulativeVsHoldUsd).toBeCloseTo(6 * 1_200 + 4 * -4_600, 6);
  });

  it('样本少于 10 笔标注结论不可靠', () => {
    const { groups } = buildDecisionStats([
      trade('a', dip10(), 'hit', { vs_hold_pct: 19 }),
      trade('b', dip10(), 'miss', { vs_hold_pct: -44 }),
    ]);
    const group = groups.find((item) => item.key === 'rebuy_after_dip_10')!;

    expect(group).toMatchObject({ samples: 2, baseline: 0.62, reliable: false, note: '样本太少，结论不可靠' });
    expect(group.hitRate).toBeCloseTo(0.5, 6);
  });

  it('参考标的不是 QQQ 的回调预判标注无基准', () => {
    const { groups } = buildDecisionStats([
      trade('a', { type: 'rebuy_after_dip', dip_pct: 10, reference_symbol: 'NVDA' }, 'hit', { symbol: 'NVDA' }),
    ]);

    expect(groups[0]).toMatchObject({ key: 'rebuy_after_dip_other', baseline: null });
    expect(groups[0].note).toContain('无基准');
    expect(groups[0].note).toContain('样本太少');
  });

  it('止盈规则只展示不计入命中率；过期单独计数', () => {
    const { groups } = buildDecisionStats([
      trade('a', { type: 'take_profit_rule', trailing_pct: 15, fixed_gain_pct: null }, 'hit'),
      trade('b', { type: 'take_profit_rule', trailing_pct: 15, fixed_gain_pct: null }, 'miss'),
      trade('c', dip5(), 'expired', { vs_hold_pct: -8 }),
    ]);

    const takeProfit = groups.find((item) => item.key === 'take_profit_rule')!;
    expect(takeProfit.hitRate).toBeNull();
    expect(takeProfit.note).toContain('不计入命中率');
    expect(takeProfit.samples).toBe(2);

    const dip = groups.find((item) => item.key === 'rebuy_after_dip_5')!;
    expect(dip).toMatchObject({ expired: 1, samples: 0 });
    expect(dip.hitRate).toBeNull();
  });

  it('没有任何预判时只报待补充条数', () => {
    const { groups, pendingNotes } = buildDecisionStats([trade('a', null, 'pending_note'), trade('b', { type: 'none' }, 'in_progress')]);

    expect(groups).toEqual([]);
    expect(pendingNotes).toBe(1);
  });
});
