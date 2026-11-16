import { describe, expect, it } from 'vitest';
import { annualSlope, compareZ, decisionSignalRow, estimatedPreview, midChannel, nearLowerBand, nearUpperBand, OBSERVATION_LABELS, previewQuoteFrom, reviewedZ, zBarColor, zObservationSignal, zSignal } from './decisionSignals';
import type { QuantChannelAlert, QuantMaSlopeDashboardPoint, QuantAnalysisSnapshot } from './types';
import { quantAnalysisFixture } from './testFixtures/quantAnalysis';

describe('decision signal presentation', () => {
  it.each([
    [-2, 'buy'], [-1.5, 'buy'], [-1.499, 'buy_near'], [-1.25, 'buy_near'], [-1.249, 'neutral'],
    [0, 'neutral'], [1.249, 'neutral'], [1.25, 'sell_near'], [1.499, 'sell_near'], [1.5, 'sell'], [2, 'sell'],
    [NaN, 'insufficient'], [Infinity, 'insufficient'], [null, 'insufficient'], [undefined, 'insufficient'],
  ] as const)('classifies %s as %s without boundary gaps', (z, state) => expect(zSignal(z)).toBe(state));

  it.each([
    [-2, 'buy'], [-1.5, 'buy'], [-1.499, 'buy_near'], [-1.25, 'buy_near'], [-1.249, 'neutral'],
    [-0.08, 'neutral'], [-0.001, 'neutral'], [0, 'neutral'], [0.58, 'neutral'], [1.249, 'neutral'],
    [1.25, 'sell_near'], [1.499, 'sell_near'], [1.5, 'sell'], [2, 'sell'],
    [NaN, 'insufficient'], [Infinity, 'insufficient'], [null, 'insufficient'], [undefined, 'insufficient'],
  ] as const)('places reviewed Z %s in observation bucket %s', (z, state) => expect(zObservationSignal(z)).toBe(state));

  it('价格优先：只看顶部和底部，通道中间不归入买入也不归入卖出', () => {
    expect(OBSERVATION_LABELS[zObservationSignal(-1.6)]).toBe('已击穿下沿');
    expect(OBSERVATION_LABELS[zObservationSignal(-1.3)]).toBe('接近下沿');
    expect(OBSERVATION_LABELS[zObservationSignal(-0.08)]).toBe('通道中间');
    expect(OBSERVATION_LABELS[zObservationSignal(0.58)]).toBe('通道中间');
    expect(OBSERVATION_LABELS[zObservationSignal(1.3)]).toBe('接近上沿');
    expect(OBSERVATION_LABELS[zObservationSignal(1.6)]).toBe('已突破上沿');
    expect(Object.values(OBSERVATION_LABELS)).not.toContain('买入观察');
    expect(Object.values(OBSERVATION_LABELS)).not.toContain('卖出观察');
    expect([nearLowerBand(-1.25), nearLowerBand(-1.24), nearLowerBand(null)]).toEqual([true, false, false]);
    expect([nearUpperBand(1.25), nearUpperBand(1.24), nearUpperBand(null)]).toEqual([true, false, false]);
    expect([midChannel(-1.24), midChannel(0), midChannel(1.24), midChannel(-1.25), midChannel(1.25), midChannel(null)])
      .toEqual([true, true, true, false, false, false]);
  });

  it('does not turn missing values into a trading signal', () => {
    const alert = { available: true, as_of: '2026-09-15', z_score: -1.6 } as QuantChannelAlert;
    expect(reviewedZ(alert)).toBe(-1.6);
    expect(reviewedZ({ ...alert, available: false })).toBeNull();
    expect(reviewedZ({ ...alert, as_of: null })).toBeNull();
    expect(reviewedZ({ ...alert, z_score: undefined })).toBeNull();
    expect(reviewedZ({ ...alert, z_score: NaN })).toBeNull();
  });

  it('刷新失败时保留上一份完整收盘的 Z，观察分区不清空', () => {
    const alert = { available: true, as_of: '2026-10-15', z_score: 0.819362, stale: true } as QuantChannelAlert;

    expect(reviewedZ(alert)).toBe(0.819362);
    expect(zObservationSignal(reviewedZ(alert))).toBe('neutral');
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
    expect(row.state).toBe('buy');
    expect(OBSERVATION_LABELS[row.state]).toBe('已击穿下沿');
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

  it('sorts the Z-Score column like Excel: high→low or low→high, missing Z always last', () => {
    const rows = [
      { symbol: 'TSLA', z: 0.16 }, { symbol: 'KO', z: 1.92 }, { symbol: 'SPCX', z: null },
      { symbol: 'META', z: -0.04 }, { symbol: 'COPX', z: -1.61 }, { symbol: 'MSFT', z: 1.82 },
    ];
    expect([...rows].sort(compareZ('desc')).map((row) => row.symbol)).toEqual(['KO', 'MSFT', 'TSLA', 'META', 'COPX', 'SPCX']);
    expect([...rows].sort(compareZ('asc')).map((row) => row.symbol)).toEqual(['COPX', 'META', 'TSLA', 'MSFT', 'KO', 'SPCX']);
  });
});

describe('夜盘、盘前、盘后的盘中预览：用现价估算 Z', () => {
  const point = (date: string, ma200: number, partial = false) => ({
    date, close: ma200, open: null, high: null, low: null, volume: null, ma200, std200: 10, zscore200: 0.5, is_partial: partial,
  });
  // 11-03 那根是盘中取的缓存，还标着未收盘
  const points = [point('2026-11-02', 100), point('2026-11-03', 101, true)];

  it('夜盘（美东 11-03 21:30）：基准是当天已收盘那根，Z =（现价 − 均值）/ 标准差', () => {
    const preview = estimatedPreview(points, { price: 121, stale: false, session: 'overnight', priceTime: '2026-11-04T02:27:24.000Z' }, new Date('2026-11-04T02:30:00.000Z'));
    expect(preview).toMatchObject({ date: '2026-11-03', close: 121, session: 'overnight', slopeDate: '2026-11-03' });
    expect(preview!.z).toBeCloseTo(2, 6);
  });

  it('盘前（美东 11-04 08:00）：基准是上一个交易日那根', () => {
    const preview = estimatedPreview(points, { price: 96, stale: false, session: 'pre', priceTime: '2026-11-04T12:58:00.000Z' }, new Date('2026-11-04T13:00:00.000Z'));
    expect(preview).toMatchObject({ date: '2026-11-04', session: 'pre', slopeDate: '2026-11-03' });
    expect(preview!.z).toBeCloseTo(-0.5, 6);
  });

  it('常规时段、休市、报价过期或缺均值标准差时不估', () => {
    const now = new Date('2026-11-04T02:30:00.000Z');
    expect(estimatedPreview(points, { price: 121, stale: false, session: 'regular', priceTime: null }, now)).toBeNull();
    expect(estimatedPreview(points, { price: 121, stale: false, session: 'closed', priceTime: null }, now)).toBeNull();
    expect(estimatedPreview(points, { price: 121, stale: true, session: 'overnight', priceTime: null }, now)).toBeNull();
    expect(estimatedPreview(points, null, now)).toBeNull();
    expect(estimatedPreview([{ ...point('2026-11-03', 101), std200: null }], { price: 121, stale: false, session: 'overnight', priceTime: null }, now)).toBeNull();
  });

  it('没有成交时间的价不估：夜盘没推上来时退回的是白天收盘价（VOO 就是这样），不能冒充夜盘价', () => {
    const now = new Date('2026-11-04T02:30:00.000Z');
    expect(estimatedPreview(points, { price: 693.54, stale: false, session: 'overnight', priceTime: null }, now)).toBeNull();
  });

  it('从报价接口的返回里取这只股票的现价和时段', () => {
    const body = {
      quotes: [{ symbol: 'NVDA', price: 206.69, stale: false, priceTime: '2026-11-04T02:27:24.061Z' }],
      session: 'overnight',
    };
    expect(previewQuoteFrom(body, 'NVDA')).toEqual({ price: 206.69, stale: false, session: 'overnight', priceTime: '2026-11-04T02:27:24.061Z' });
    expect(previewQuoteFrom(body, 'AAPL')).toBeNull();
    expect(previewQuoteFrom(null, 'NVDA')).toBeNull();
  });
});
