import { describe, expect, it } from 'vitest';
import { annualSlope, decisionSignalRow, OBSERVATION_LABELS, reviewedZ, zBarColor, zObservationSignal, zSignal } from './decisionSignals';
import type { QuantChannelAlert, QuantMaSlopeDashboardPoint, QuantAnalysisSnapshot } from './types';
import { quantAnalysisFixture } from './testFixtures/quantAnalysis';

describe('decision signal presentation', () => {
  it.each([
    [-2, 'buy'], [-1.5, 'buy'], [-1.499, 'buy_near'], [-1.25, 'buy_near'], [-1.249, 'neutral'],
    [0, 'neutral'], [1.249, 'neutral'], [1.25, 'sell_near'], [1.499, 'sell_near'], [1.5, 'sell'], [2, 'sell'],
    [NaN, 'insufficient'], [Infinity, 'insufficient'], [null, 'insufficient'], [undefined, 'insufficient'],
  ] as const)('classifies %s as %s without boundary gaps', (z, state) => expect(zSignal(z)).toBe(state));

  it.each([
    [-2, 'buy_near'], [-1.5, 'buy_near'], [-0.001, 'buy_near'], [0, 'neutral'],
    [0.001, 'sell_near'], [1.5, 'sell_near'], [2, 'sell_near'],
    [NaN, 'insufficient'], [Infinity, 'insufficient'], [null, 'insufficient'], [undefined, 'insufficient'],
  ] as const)('places reviewed Z %s in observation bucket %s', (z, state) => expect(zObservationSignal(z)).toBe(state));

  it('does not turn failed/stale reviews or missing values into a trading signal', () => {
    const alert = { available: true, as_of: '2026-09-15', z_score: -1.6 } as QuantChannelAlert;
    expect(reviewedZ(alert)).toBe(-1.6);
    expect(reviewedZ({ ...alert, stale: true })).toBeNull();
    expect(reviewedZ({ ...alert, available: false })).toBeNull();
    expect(reviewedZ({ ...alert, as_of: null })).toBeNull();
    expect(reviewedZ({ ...alert, z_score: undefined })).toBeNull();
    expect(reviewedZ({ ...alert, z_score: NaN })).toBeNull();
  });

  it('annualizes exactly 20 trading sessions instead of multiplying the 8-day slope', () => {
    const points = Array.from({ length: 21 }, (_, index) => ({ date: `day-${index}`, ma200: 100 + index, close: 140, slope200: 99 }) as QuantMaSlopeDashboardPoint);
    expect(annualSlope(points, 'day-20')).toBeCloseTo(252);
    expect(annualSlope(points, 'day-19')).toBeNull();
    expect(annualSlope(points, 'missing')).toBeNull();
    points[0].ma200 = 0;
    expect(annualSlope(points, 'day-20')).toBeNull();
  });

  it('keeps the benchmark drawdown independent of own-ticker Z and does not alter the final verdict', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.symbols.TQQQ = structuredClone(snapshot.symbols.AMZN);
    snapshot.symbols.TQQQ.execution_standard = { basis_symbol: 'QQQ', threshold_pct: 17.5, source: 'test', execution_allowed: true };
    snapshot.final_verdict = { symbols: { TQQQ: { symbol: 'TQQQ', verdict: 'NO_BUY' } } };
    const row = decisionSignalRow(snapshot, 'TQQQ', { available: true, as_of: '2026-09-15', z_score: -1.5 } as QuantChannelAlert);
    expect(row.decision.priceLabel).toBe('QQQ');
    expect(row.state).toBe('buy_near');
    expect(OBSERVATION_LABELS[row.state]).toBe('买入观察');
    expect(row.decision.ready).toBe(false);
    expect(snapshot.final_verdict.symbols?.TQQQ.verdict).toBe('NO_BUY');
  });

  it('uses dark red above +1.5 and dark green below -1.5; neutral bars are lighter', () => {
    expect(zBarColor(1.5)).toBe('#dc2626');
    expect(zBarColor(0.8)).toBe('#f87171');
    expect(zBarColor(-1.5)).toBe('#059669');
    expect(zBarColor(-0.8)).toBe('#6ee7b7');
    expect(zBarColor(null)).toBe('#94a3b8');
  });
});
