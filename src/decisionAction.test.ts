import { describe, expect, it } from 'vitest';
import { decisionAction } from './decisionAction';
import { smaIndicators, type SmaIndicators } from './decisionIndicators';
import { quantAnalysisFixture } from './testFixtures/quantAnalysis';
import type { QuantAnalysisSnapshot, QuantSellFamily } from './types';

const NOW = Date.parse('2026-10-06T05:00:00Z');
const fresh = '2026-10-06T04:54:00Z';
const trend: SmaIndicators = { ...smaIndicators(), asOf: '2026-10-05', slope200: .05, risk: 'up', severe: false };
function snapshot(verdict: 'BUY' | 'NO_BUY' | 'UNDECIDABLE' = 'NO_BUY') {
  const value = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
  value.generated_at = fresh;
  value.freshness = { data_stale: false, sell_evaluated_at: fresh } as QuantAnalysisSnapshot['freshness'];
  value.final_verdict = { data_stale: false, symbols: { TEST: { symbol: 'TEST', verdict, data_stale: false, data_as_of: '2026-10-05' } } };
  value.symbols.TEST = { available: true, depth_window: { applicable: true, open: verdict === 'BUY', current_pct: verdict === 'BUY' ? 20 : 5, threshold_pct: 10, high_price: 100, current_price: verdict === 'BUY' ? 80 : 95 } } as QuantAnalysisSnapshot['symbols'][string];
  value.sell = { shadow: true, symbols: { TEST: {
    family: 'TEST', held_symbols: ['TEST'], positions: [{ symbol: 'TEST', asset_type: 'stock', quantity: 1 }],
    profit_gate: { available: true },
    decision: { verdict: 'WAIT', label: '再等等', notification_state: 'wait', reason: '原规则尚未触发卖出', recommended_sell_pct: 0, evidence: {
      profit: { status: 'below_ladder', pnl_pct: 2, threshold_pct: 5 },
      history: { status: 'far' }, valuation: { status: 'normal' }, sentiment: { status: 'normal' },
    } },
  } as unknown as QuantSellFamily } };
  return value;
}
function sell(value: QuantAnalysisSnapshot) { return value.sell!.symbols.TEST; }
const action = (value: QuantAnalysisSnapshot, held = false, sma = trend) => decisionAction(value, 'TEST', held, sma, NOW);

describe('decision action presentation, independent of observation signals', () => {
  it('shows BUY only with both formal permission and existing entry conditions', () => {
    expect(action(snapshot('BUY')).kind).toBe('buy');
    expect(action(snapshot('BUY'), true).label).toBe('可按计划加仓');
    const value = snapshot('BUY'); value.symbols.TEST.depth_window!.open = false;
    expect(action(value).kind).toBe('review');
  });
  it('does not turn a passed drawdown without final permission into BUY', () => {
    const value = snapshot(); value.symbols.TEST.depth_window!.open = true;
    expect(action(value).kind).toBe('wait');
  });
  it('preserves drawdown-first BUY even without PE or with a technical warning', () => {
    expect(action(snapshot('BUY'), false, { ...trend, severe: true, risk: 'below' }).kind).toBe('buy');
  });
  it('shows waiting and names the correct reference instrument/price', () => {
    const value = snapshot();
    value.symbols.TEST.execution_standard = { basis_symbol: 'QQQ', threshold_pct: 10, execution_allowed: true, source: 'period_median' };
    expect(action(value)).toMatchObject({ kind: 'wait', reason: '回撤距参考线还差 5.00 个百分点', next: '关注 QQQ 回撤参考价 $90.00' });
  });
  it('never translates missing, unknown or stale verdicts into hold', () => {
    const value = snapshot(); value.final_verdict = undefined;
    expect(action(value, true).kind).toBe('review');
    expect(action(snapshot('UNDECIDABLE'), true).kind).toBe('review');
    value.final_verdict = { data_stale: true, symbols: {} };
    expect(action(value).reason).toContain('过期');
  });
  it.each(['2026-10-01T00:00:00Z', 'invalid', '2026-10-07T00:00:00Z'])('rejects invalid snapshot time %s', stamp => {
    const value = snapshot('BUY'); value.generated_at = stamp;
    expect(action(value).kind).toBe('review');
  });
  it('does not turn NO_BUY into HOLD without a fresh sell decision', () => {
    const value = snapshot(); value.sell = undefined;
    expect(action(value, true).kind).toBe('review');
    const stale = snapshot(); stale.freshness!.sell_evaluated_at = '2026-10-01T00:00:00Z';
    expect(action(stale, true).kind).toBe('review');
  });
  it('holds only a real holding with complete WAIT evidence and no trend warning', () => {
    expect(action(snapshot(), true).kind).toBe('hold');
    expect(action(snapshot(), false).kind).toBe('wait');
    expect(action(snapshot(), true, smaIndicators()).kind).toBe('review');
    expect(action(snapshot(), true, { ...trend, severe: true, riskLabel: '200DMA 零轴下方' }).kind).toBe('review');
    expect(action(snapshot(), true, { ...trend, asOf: '2026-10-02' }).kind).toBe('review');
  });
  it('does not call incomplete cost/PE/history evidence safe holding', () => {
    const value = snapshot(); sell(value).decision!.evidence.profit.status = 'unknown';
    expect(action(value, true).reason).toContain('成本');
    const pe = snapshot(); sell(pe).decision!.evidence.valuation.status = 'unavailable';
    expect(action(pe, true).kind).toBe('review');
    const history = snapshot(); sell(history).decision!.evidence.history.status = 'insufficient';
    expect(action(history, true).kind).toBe('review');
  });
  it('shows exact holding SELL, including its existing reduction percentage', () => {
    const value = snapshot(); Object.assign(sell(value).decision!, { verdict: 'SELL', recommended_sell_pct: 25 });
    expect(action(value, true)).toMatchObject({ kind: 'sell', label: '按计划减仓', next: '核对计划：减持 25% 持仓' });
    sell(value).decision!.recommended_sell_pct = 12.5;
    expect(action(value, true).next).toContain('12.5%');
    sell(value).decision!.recommended_sell_pct = 100;
    expect(action(value, true).label).toBe('按计划卖出');
    sell(value).decision!.recommended_sell_pct = NaN;
    expect(action(value, true).kind).toBe('review');
  });
  it('does not apply option/family sell percentages to an ordinary-share order', () => {
    const value = snapshot(); Object.assign(sell(value).decision!, { verdict: 'SELL', recommended_sell_pct: 25 });
    sell(value).positions = [{ ...sell(value).positions![0], asset_type: 'option' }];
    expect(action(value, true).kind).toBe('review');
    expect(action(value, false).kind).toBe('review');
    sell(value).held_symbols = ['TEST', 'PROXY'];
    expect(action(value, true).reason).toContain('组合');
  });
  it('reports BUY / SELL conflicts rather than picking a convenient side', () => {
    const value = snapshot('BUY'); Object.assign(sell(value).decision!, { verdict: 'SELL', recommended_sell_pct: 25 });
    expect(action(value, true).reason).toContain('同时触发');
  });
  it('shares the sell page valuation conflict guard', () => {
    const value = snapshot(); Object.assign(sell(value).decision!, { verdict: 'SELL', recommended_sell_pct: 25 });
    sell(value).decision!.evidence.valuation.current_pe = 30;
    value.pe_history = { metric: 'ttm_pe', symbols: { TEST: { current: 20 } } } as unknown as QuantAnalysisSnapshot['pe_history'];
    expect(action(value, true).reason).toContain('估值数据不一致');
    sell(value).decision!.evidence.valuation.source = 'forward_pe_1bf';
    expect(action(value, true).kind).toBe('sell');
  });
  it('does not override a server exposure warning with reassuring HOLD', () => {
    const value = snapshot(); value.exposure_bands = { level: 'warning' };
    expect(action(value, true).kind).toBe('review');
  });
  it('leaves observation, valuation and overheat values independent of execution', () => {
    const value = snapshot();
    expect(action(value, false, { ...trend, hot: true }).kind).toBe('wait');
    const before = JSON.stringify(value);
    action(value, true);
    expect(JSON.stringify(value)).toBe(before);
  });
});
