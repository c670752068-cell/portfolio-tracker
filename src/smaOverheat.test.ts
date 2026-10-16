import { describe, expect, it } from 'vitest';
import type { QuantMaSlopeDashboard } from './types';
import { smaOverheat, smaDownside } from './smaOverheat';

function fixture(peaks: number[], decline = 3): QuantMaSlopeDashboard {
  const series = Array.from({ length: Math.max(280, peaks.length * 25 + 20) }, (_, i) => ({
    date: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10), open: 100, high: 100, low: 100, close: 100,
    volume: 1, slope20: -.1, is_partial: false,
  }));
  peaks.forEach((peak, n) => { series[n * 25 + 8].slope20 = peak; series[n * 25 + 18].close = 100 - decline; });
  return { range: '5y', slope_window_sessions: 8, slope_unit: 'pct_per_day', ma_periods: [20, 50, 200], series };
}
describe('five-year slope peak / subsequent pullback statistics', () => {
  it('uses qualifying independent peak values, not daily means; includes exactly day 10 and 3%', () => {
    const value = smaOverheat(fixture([.1, .2, .3, .4, .5, .6, .7, 2]));
    expect(value.peakCount).toBe(8); expect(value.pullbackCount).toBe(8);
    expect(value.meanPeak).toBeCloseTo(.6); expect(value.medianPeak).toBeCloseTo(.45);
    expect(value.reliable).toBe(true);
  });
  it('keeps unsuccessful peaks in the denominator and excludes day 11 outcomes', () => {
    const data = fixture([1, 2], 2.99);
    data.series[19].close = 90;
    const value = smaOverheat(data);
    expect(value.peakCount).toBe(2); expect(value.pullbackCount).toBe(0);
    expect(value.meanPeak).toBeNull(); expect(value.observedPullbackPct).toBe(0);
  });
  it('does not call insufficient samples reliable', () => {
    expect(smaOverheat(fixture([.5])).reliable).toBe(false);
    expect(smaOverheat(fixture([.5])).medianPeak).toBe(.5);
  });
  it('deduplicates overlapping peaks by keeping the higher peak', () => {
    const data = fixture([1]); data.series[16].slope20 = 2; data.series[20].close = 96;
    const value = smaOverheat(data);
    expect(value.peakCount).toBe(1); expect(value.meanPeak).toBe(2);
  });
  it('counts a plateau once and excludes negative peaks', () => {
    const data = fixture([1, -.05]); data.series[9].slope20 = 1;
    expect(smaOverheat(data).peakCount).toBe(1);
  });
  it('excludes unconfirmed tails and intraday closes', () => {
    const data = fixture([]); data.series[275].slope20 = 5; data.series[279].close = 50;
    expect(smaOverheat(data).peakCount).toBe(0);
    const partial = fixture([1]); partial.series.slice(18).forEach(point => { point.is_partial = true; });
    expect(smaOverheat(partial).peakCount).toBe(0);
  });
  it('does not bridge invalid prices or slope samples', () => {
    const data = fixture([1]); data.series[13].close = NaN;
    expect(smaOverheat(data).peakCount).toBe(0);
    data.series[13].close = 100; data.series[6].slope20 = NaN;
    expect(smaOverheat(data).peakCount).toBe(0);
  });
  it('rejects other slope units/windows and clamps data to five calendar years', () => {
    const data = fixture([1]);
    expect(smaOverheat({ ...data, slope_window_sessions: 20 }).peakCount).toBe(0);
    const ancient = { ...data.series[8], date: '2010-01-01', slope20: 100 };
    expect(smaOverheat({ ...data, series: [ancient, ...data.series] }).meanPeak).toBe(1);
  });
});

function downsideFixture(troughs: number[], rebound = 3): QuantMaSlopeDashboard {
  const data = fixture(troughs.map(value => -value), rebound);
  data.series = data.series.map(point => ({ ...point, slope20: -point.slope20!, close: 200 - point.close }));
  return data;
}

describe('five-year negative slope trough / subsequent rebound statistics', () => {
  it('uses signed independent troughs; includes exactly day 10 and a 3% rebound', () => {
    const value = smaDownside(downsideFixture([-.1, -.2, -.3, -.4, -.5, -.6, -.7, -2]));
    expect(value.troughCount).toBe(8); expect(value.reboundCount).toBe(8);
    expect(value.meanTrough).toBeCloseTo(-.6); expect(value.medianTrough).toBeCloseTo(-.45);
    expect(value.reliable).toBe(true);
    expect(value.events[0].highestClose).toBe(103);
    expect(value.events[0].highestDate).toBe(value.events[0].confirmedThrough);
  });
  it('keeps unsuccessful troughs in the denominator, excludes day 11, and never invents a zero median', () => {
    const data = downsideFixture([-1, -2], 2.99);
    data.series[19].close = 120;
    const result = smaDownside(data);
    expect(result.troughCount).toBe(2); expect(result.reboundCount).toBe(0);
    expect(result.medianTrough).toBeNull(); expect(result.meanTrough).toBeNull();
    expect(result.observedReboundPct).toBe(0); expect(result.reliable).toBe(false);
  });
  it('measures rebound from the trough-day close, not a later price low or intraday high', () => {
    const data = downsideFixture([-1], 0);
    data.series[8].close = 80;
    data.series[9].close = 70;
    data.series.slice(10, 19).forEach(point => { point.close = 82.4; point.high = 200; });
    expect(smaDownside(data).events[0].reboundPct).toBeCloseTo(3);
    data.series.slice(10, 19).forEach(point => { point.close = 82; });
    expect(smaDownside(data).reboundCount).toBe(0);
  });
  it('deduplicates overlapping troughs by retaining the lower negative value', () => {
    const data = downsideFixture([-1]); data.series[16].slope20 = -2; data.series[20].close = 104;
    const value = smaDownside(data);
    expect(value.troughCount).toBe(1); expect(value.meanTrough).toBe(-2);
  });
  it('counts a flat-bottom once and excludes zero or positive troughs', () => {
    const data = downsideFixture([-1, .05, 0]); data.series[9].slope20 = -1;
    expect(smaDownside(data).troughCount).toBe(1);
  });
  it('does not qualify an unconfirmed tail or intraday observations', () => {
    const data = downsideFixture([]); data.series[275].slope20 = -5; data.series[279].close = 150;
    expect(smaDownside(data).troughCount).toBe(0);
    const partial = downsideFixture([-1]); partial.series.slice(18).forEach(point => { point.is_partial = true; });
    expect(smaDownside(partial).troughCount).toBe(0);
  });
  it('does not bridge an invalid confirmation price or neighborhood slope', () => {
    const data = downsideFixture([-1]); data.series[13].close = NaN;
    expect(smaDownside(data).troughCount).toBe(0);
    data.series[13].close = 100; data.series[6].slope20 = NaN;
    expect(smaDownside(data).troughCount).toBe(0);
  });
  it('rejects incompatible units/windows, clamps five years, and marks short history as insufficient', () => {
    const data = downsideFixture([-1]);
    expect(smaDownside({ ...data, slope_window_sessions: 20 }).troughCount).toBe(0);
    const ancient = { ...data.series[8], date: '2010-01-01', slope20: -100 };
    expect(smaDownside({ ...data, series: [ancient, ...data.series] }).medianTrough).toBe(-1);
    expect(smaDownside(data).reliable).toBe(false);
    const short = downsideFixture(Array(8).fill(-1));
    short.series = short.series.slice(0, 220);
    expect(smaDownside(short).reboundCount).toBe(8);
    expect(smaDownside(short).reliable).toBe(false);
    expect(smaDownside(short).fullFiveYears).toBe(false);
    expect(smaDownside().medianTrough).toBeNull();
  });
  it('is symmetric to the unchanged positive peak rules', () => {
    const up = smaOverheat(fixture([.1, .3, .8, 1.2]));
    const down = smaDownside(downsideFixture([-.1, -.3, -.8, -1.2]));
    expect(down.reboundCount).toBe(up.pullbackCount);
    expect(down.troughCount).toBe(up.peakCount);
    expect(down.meanTrough).toBeCloseTo(-up.meanPeak!);
    expect(down.medianTrough).toBeCloseTo(-up.medianPeak!);
    expect(down.events.map(event => event.date)).toEqual(up.events.map(event => event.date));
  });
});
