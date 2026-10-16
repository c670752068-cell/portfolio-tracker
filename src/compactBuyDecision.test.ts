import { describe, expect, it } from 'vitest';
import type { QuantAnalysisSnapshot, QuantFinalVerdictEnvelope } from './types';
import { buildCompactBuyDecision } from './compactBuyDecision';

function snapshot({
  symbol = 'AAPL',
  current = 9,
  threshold = 10,
  open = false,
  valuationPassed = true,
}: {
  symbol?: string;
  current?: number;
  threshold?: number;
  open?: boolean;
  valuationPassed?: boolean;
} = {}): QuantAnalysisSnapshot {
  return {
    symbols: {
      [symbol]: {
        available: true,
        depth_window: {
          applicable: true,
          open,
          current_pct: current,
          threshold_pct: threshold,
          current_price: 101,
          threshold_price: 99.9,
          next_level_price: 99.9,
          price_session: 'regular',
          win_rate_60d: null,
          n: 0,
          sample_insufficient: true,
          bear_included: false,
        },
      },
    },
    summary: {
      depth_states: {
        [symbol]: {
          status: open ? 'ready' : 'near',
          progress_pct: current / threshold * 100,
          gap_pct: Math.max(0, threshold - current),
          excess_pct: Math.max(0, current - threshold),
        },
      },
    },
    final_verdict: {
      symbols: {
        [symbol]: {
          symbol,
          verdict: open ? 'BUY' : 'NO_BUY',
          layers: [{
            layer: 'gates_six',
            label: '价格与估值',
            state: valuationPassed ? 'passed' : 'failed',
            passed: valuationPassed,
            reason: valuationPassed ? '估值已进入买入区间' : '估值未进入买入区间',
          }],
        },
      },
    },
  } as unknown as QuantAnalysisSnapshot;
}

describe('buildCompactBuyDecision', () => {
  it('says not to buy and gives the remaining decline and reference price', () => {
    const result = buildCompactBuyDecision(snapshot(), 'AAPL');

    expect(result.ready).toBe(false);
    expect(result.label).toBe('暂时不买');
    expect(result.message).toContain('还需下跌 1.00 个百分点');
    expect(result.targetPrice).toBe(99.9);
    expect(result.excessPct).toBe(0);
  });

  it('says buy from drawdown even when valuation fails', () => {
    const result = buildCompactBuyDecision(snapshot({ current: 11, open: true, valuationPassed: false }), 'AAPL');

    expect(result.ready).toBe(true);
    expect(result.label).toBe('可以买');
    expect(result.message).toContain('回撤已达到买入线');
    expect(result.message).toContain('回撤越深，买入优先级越高');
    expect(result.excessPct).toBe(1);
  });

  it('never overrides the backend final verdict with local green subconditions', () => {
    const value = snapshot({ current: 11, open: true });
    const envelope = value.final_verdict as QuantFinalVerdictEnvelope;
    const final = envelope.symbols.AAPL!;
    final.verdict = 'NO_BUY';
    final.single_sentence = '不买：已有卖出军令。';

    const result = buildCompactBuyDecision(value, 'AAPL');

    expect(result.ready).toBe(false);
    expect(result.label).toBe('暂时不买');
    expect(result.message).toBe('不买：已有卖出军令。');
  });

  it('shows the backend reason when the final verdict cannot be determined', () => {
    const value = snapshot();
    const envelope = value.final_verdict as QuantFinalVerdictEnvelope;
    const final = envelope.symbols.AAPL!;
    final.verdict = 'UNDECIDABLE';
    final.single_sentence = '无法判定：回撤证据不可用，无法判定。';

    const result = buildCompactBuyDecision(value, 'AAPL');

    expect(result.ready).toBe(false);
    expect(result.label).toBe('数据不足');
    expect(result.message).toBe('无法判定：回撤证据不可用，无法判定。');
  });

  it('ignores unavailable valuation evidence when drawdown passes', () => {
    const value = snapshot({ current: 11, open: true });
    value.symbols!.AAPL!.gates = {
      valuation: {
        passed: true,
        available: false,
        reason: '指数估值或 CNN 情绪数据缺失',
      },
    };
    const envelope = value.final_verdict as QuantFinalVerdictEnvelope;
    envelope.symbols.AAPL!.verdict = 'BUY';

    const result = buildCompactBuyDecision(value, 'AAPL');

    expect(result.ready).toBe(true);
    expect(result.message).toContain('回撤已达到买入线');
  });

  it('does not let failed valuation override a passed drawdown', () => {
    const result = buildCompactBuyDecision(snapshot({ current: 11, open: true, valuationPassed: false }), 'AAPL');

    expect(result.ready).toBe(true);
    expect(result.message).not.toContain('估值');
  });

  it('keeps a drawdown-qualified stock buyable when the complete slope model is negative', () => {
    const value = snapshot({ symbol: 'AVGO', current: 27.08, threshold: 14.02, open: true });
    value.symbols.AVGO.ma_slope = {
      available: true,
      model: 'ma200_20d_annualized',
      role: 'trend_context_only',
      buy_veto: false,
      ma_period: 200,
      change_window_sessions: 20,
      annualization_sessions: 252,
      annualized_pct: -12.34,
      current_ma: 390.25,
      comparison_ma: 409.31,
      direction: 'down',
      regime: 'strong_down',
      label: '强势下跌',
      as_of: '2026-08-19',
      price_adjustment: 'QFQ',
      data_source: 'Futu OpenD closed daily bars',
      formula: '(MA200_t / MA200_t-20 - 1) × 252 / 20 × 100',
      reason: '200日均线斜率为 -12.34%，属于强势下跌；仅作趋势风险说明，不否决回撤买点。',
    };

    const result = buildCompactBuyDecision(value, 'AVGO');

    expect(result.ready).toBe(true);
    expect(result.label).toBe('可以买');
    expect(result.maSlope?.annualized_pct).toBe(-12.34);
    expect(result.maSlope?.buy_veto).toBe(false);
  });

  it('does not surface valuation as a buy blocker', () => {
    const value = snapshot({ symbol: 'AVGO', current: 27.08, threshold: 14.02, open: true, valuationPassed: false });
    value.symbols!.AVGO!.gates = {
      low_zone: { passed: true },
      valuation: {
        passed: false,
        reason: '个股 PE 分位 56.66，高于买入线 30.00',
      },
    };

    const result = buildCompactBuyDecision(value, 'AVGO');

    expect(result.ready).toBe(true);
    expect(result.message).not.toContain('PE');
  });

  it('uses the backend drawdown verdict instead of valuation state', () => {
    const value = snapshot({ symbol: 'META', current: 25.19, threshold: 33.3 });
    value.symbols!.META!.gates = {
      low_zone: { applicable: true, passed: false, reason: '回撤未到旧统计中位线' },
      valuation: { applicable: true, passed: true, reason: '估值已进入买入区间' },
    };
    const finalSymbols = value.final_verdict!.symbols as Record<string, { layers?: unknown[] }>;
    finalSymbols.META!.layers = [{
      layer: 'gates_six', state: 'failed', passed: false,
      reason: '未通过：回撤',
    }];

    const result = buildCompactBuyDecision(value, 'META');

    expect(result.ready).toBe(false);
    expect(result.message).toContain('还需下跌');
  });

  it('uses the 1x benchmark gap and trigger price for a leveraged ETF', () => {
    const value = snapshot({ symbol: 'TQQQ', current: 7.69, threshold: 11 });
    value.final_verdict = { symbols: { TQQQ: {
      symbol: 'TQQQ', verdict: 'NO_BUY', layers: [
        { layer: 'gates_six', state: 'passed', passed: true, reason: '估值已通过' },
        { layer: 'entry_gate_1x', state: 'failed', passed: false, benchmark: 'QQQ', gap_pp: 3.31, trigger_price: 663.35 },
      ],
    } } };

    const result = buildCompactBuyDecision(value, 'TQQQ');

    expect(result.message).toContain('QQQ 还需下跌 3.31 个百分点');
    expect(result.priceLabel).toBe('QQQ');
    expect(result.targetPrice).toBe(663.35);
  });
});
