import { describe, expect, it } from 'vitest';
import { pePosition, resolvePeEntry, resolveIssuerPeEntry, slopePerDay, smaIndicators } from './decisionIndicators';
import type { PeHistoryPayload } from './peData';
import type { QuantIndexEtfValuation, QuantMaSlopeDashboard, QuantMaSlopeDashboardPoint } from './types';

const history: PeHistoryPayload = { metric: 'ttm_pe', generated_at: '', frequency: 'daily', lookback_years: 5, percentile_definition: '', symbols: {
  NDX: { current: 17.25, percentile: 3.7, source: 'index', series_start: '2021-01-01', series_end: '2026-01-01', frequency: 'weekly', series: [20, 23, 25, 28, 30].map(value => ({ date: '2026-01-01', value })) },
} };
function dashboard(values: Array<Partial<QuantMaSlopeDashboardPoint>>, window = 8): QuantMaSlopeDashboard {
  return { range: '5y', slope_window_sessions: window, slope_unit: 'pct_per_day', ma_periods: [20, 50, 200], series: values.map((value, i) => ({ date: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10), open: 1, high: 1, low: 1, close: 1, volume: 1, ...value })) };
}

describe('decision indicators', () => {
  it('uses explicit leveraged underlyings without scaling their PE or inventing ETF earnings', () => {
    const own = { ...history, symbols: { TSLA: history.symbols.NDX } };
    expect(pePosition('TSLL', own).current).toBe(17.25);
    expect(pePosition('TSLL', own).basis).toBe('TSLA');
    expect(pePosition('TSLL', own).note).toContain('基础股票');
    expect(pePosition('GLDM').label).toBe('PE 不适用');
    expect(resolvePeEntry('SOX', { ...history, symbols: { SOXX: history.symbols.NDX } })).toBeUndefined();
  });
  it('keeps issuer PE methodology and does not invent five-year ranks for leveraged sector funds', () => {
    const issuer: QuantIndexEtfValuation = { generated_at: '', symbols: { SOXX: {
      symbol: 'SOXX', basis_symbol: 'SOXX', basis_name: 'Semiconductor ETF', available: true,
      current_pe: 51.04, forward_pe: null, as_of: '2026-10-02', source: 'iShares', source_url: 'https://www.ishares.com/',
      historical_available: false, history_note: '非 TTM；最近财年', metric_label: '基金 PE（最近财年）',
    } } };
    const value = pePosition('SOXL', undefined, issuer);
    expect(value.current).toBe(51.04); expect(value.percentile).toBeNull(); expect(value.median).toBeNull();
    expect(value.metricLabel).toContain('最近财年'); expect(value.note).toContain('非杠杆 ETF 自身 PE');
    expect(resolveIssuerPeEntry('SOX', issuer)).toBeUndefined();
    expect(pePosition('SOXX', { ...history, symbols: { SOXX: history.symbols.NDX } }, issuer).current).toBe(17.25);
  });
  it('marks heat only after enough confirmed pullback peaks, independent of the annual slope', () => {
    const data = dashboard(Array.from({ length: 300 }, (_, i) => ({ slope20: i % 25 === 8 ? .5 : -.1, close: i % 25 === 18 ? 95 : 100 })));
    data.series.at(-1)!.slope20 = .6;
    const result = smaIndicators(data);
    expect(result.overheat.reliable).toBe(true); expect(result.hot).toBe(true);
    expect(result.overheat.medianPeak).toBe(.5);
    expect(result.heatLabel).toBe('达到回落峰值参考');
  });
  it('labels explicit ETF proxies and never replaces an unavailable stock', () => {
    expect(resolvePeEntry('QQQ', history)?.basis_symbol).toBe('NDX');
    expect(resolvePeEntry('TQQQ', history)?.basis_note).toContain('非 ETF 自身 PE');
    expect(resolvePeEntry('MSFT', history)).toBeUndefined();
    expect(resolvePeEntry('QQQ', { ...history, metric: 'forward_pe' })).toBeUndefined();
  });
  it('marks negative speed only against the reliable, signed rebound-trough median', () => {
    const data = dashboard(Array.from({ length: 300 }, (_, i) => ({ slope20: i % 25 === 8 ? -.5 : .1, close: i % 25 === 18 ? 105 : 100 })));
    data.series.at(-1)!.slope20 = -.6;
    const result = smaIndicators(data);
    expect(result.downside.reliable).toBe(true);
    expect(result.downside.medianTrough).toBe(-.5);
    expect(result.cold).toBe(true); expect(result.hot).toBe(false);
    expect(result.heatLabel).toContain('下降偏快');
    data.series.at(-1)!.slope20 = -.4;
    expect(smaIndicators(data).cold).toBe(false);
    data.series.at(-1)!.slope20 = -.5;
    expect(smaIndicators(data).cold).toBe(true);
    for (const slope20 of [0, .6, null]) {
      data.series.at(-1)!.slope20 = slope20;
      expect(smaIndicators(data).cold).toBe(false);
    }
  });
  it('does not label the lowest negative daily percentile fast without confirmed rebound samples', () => {
    const data = dashboard(Array.from({ length: 300 }, (_, i) => ({ slope20: -i / 100 })));
    expect(smaIndicators(data).percentile20).toBeLessThan(1);
    expect(smaIndicators(data).cold).toBe(false);
    expect(smaIndicators(data).heatLabel).toBe('短线下降');
  });
  it('keeps high/low direction and actual quantile values distinct from percentile', () => {
    const value = pePosition('QQQ', history);
    expect(value.current).toBe(17.25);
    expect(value.percentile).toBe(3.7);
    expect(value.median).toBe(25);
    expect(value.q30).toBeCloseTo(23.4);
    expect(value.q70).toBeCloseTo(27.4);
    expect(value.relativeToMedian).toBeCloseTo(-31);
    expect(value.tone).toBe('low');
  });
  it('does not treat zero, negative, NaN or missing PE as cheap', () => {
    for (const current of [0, -2, NaN, null]) {
      const value = pePosition('NDX', { ...history, symbols: { NDX: { ...history.symbols.NDX, current } } });
      expect(value.current).toBeNull(); expect(value.percentile).toBeNull(); expect(value.tone).toBe('unknown');
    }
  });
  it.each([[.1, -.01, 'down_cross'], [.1, 0, 'touch'], [-.1, -.05, 'below'], [.1, .005, 'near'], [.1, .02, 'up'], [.1, null, 'unavailable']] as const)('classifies 200DMA from %/day, previous %s to %s', (previous, current, risk) => {
    expect(smaIndicators(dashboard([{ slope200: previous }, { slope200: current }])).risk).toBe(risk);
  });
  it('does not call a tiny positive slope a zero touch after rounding', () => {
    expect(smaIndicators(dashboard([{ slope200: .0004 }])).risk).toBe('near');
    expect(slopePerDay(.0004)).toBe('+0.0004');
    expect(slopePerDay(-.0004)).toBe('-0.0004');
  });
  it('excludes intraday values and rejects a different slope window', () => {
    const data = dashboard([{ slope200: .1 }, { slope200: .2 }, { slope200: -.2, is_partial: true }]);
    expect(smaIndicators(data).risk).toBe('up');
    expect(smaIndicators({ ...data, slope_window_sessions: 20 }).slope200).toBeNull();
  });
  it('requires enough history and positive speed for heat, with tie-safe ranks', () => {
    expect(smaIndicators(dashboard([{ slope20: 3 }])).percentile20).toBeNull();
    expect(smaIndicators(dashboard(Array.from({ length: 253 }, () => ({ slope20: 0 })))).hot).toBe(false);
    const heated = smaIndicators(dashboard(Array.from({ length: 253 }, (_, i) => ({ slope20: i / 100 }))));
    expect(heated.hot).toBe(false); expect(heated.percentile20).toBeGreaterThan(99); // No confirmed pullback peaks, despite a high rank.
    const negative = smaIndicators(dashboard(Array.from({ length: 253 }, (_, i) => ({ slope20: -3 + i / 100 }))));
    expect(negative.hot).toBe(false);
  });
});
