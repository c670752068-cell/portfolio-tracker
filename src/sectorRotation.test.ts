import { describe, expect, it } from 'vitest';
import { relativePerformance, rotationTrail, rotationState, stockSector, signedPercent, signedPp, SECTORS, type RotationHistory } from './sectorRotation';

function history(count = 400, rate = .001): RotationHistory {
  const series = [];
  const date = new Date('2025-01-01T12:00:00Z');
  while (series.length < count) {
    if (![0, 6].includes(date.getUTCDay())) series.push({ date: date.toISOString().slice(0, 10), close: 100 * (1 + rate) ** series.length });
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return { symbol: 'TEST', available: true, stale: false, adjustment: 'split_and_dividend_adjusted', series, as_of: series.at(-1)!.date };
}
describe('sector relative strength', () => {
  it('contains exactly 11 sector proxies and only explicit stock classifications', () => {
    expect(new Set(SECTORS.map(s => s.symbol)).size).toBe(11);
    expect(stockSector('NVDA')).toBe('XLK');
    expect(stockSector('GOOG')).toBe('XLC');
    expect(stockSector('TSLA')).toBe('XLY');
    for (const symbol of ['SPCX', 'TQQQ', 'GLDM', 'MAGS', 'SOXL', 'VOO']) expect(stockSector(symbol)).toBeNull();
  });
  it('uses identical dates and percentage POINTS, not ratio return, for excess', () => {
    const benchmark = history(22, 0); benchmark.series!.at(-1)!.close = 105;
    const stock = history(22, 0); stock.series!.at(-1)!.close = 110;
    const result = relativePerformance(stock, benchmark, 21);
    expect(result.available).toBe(true);
    expect(result.assetReturn).toBeCloseTo(10);
    expect(result.benchmarkReturn).toBeCloseTo(5);
    expect(result.excessPp).toBeCloseTo(5);
    expect(result.points.at(-1)!.ratio - 100).toBeCloseTo(4.76190476);
    expect(result.points[0]).toMatchObject({ asset: 100, benchmark: 100, ratio: 100 });
  });
  it('requires the full interval and never silently fills gaps or mixes raw with adjusted prices', () => {
    const stock = history(), benchmark = history();
    expect(relativePerformance(stock, benchmark, 252).points).toHaveLength(253);
    stock.series!.splice(-10, 1);
    expect(relativePerformance(stock, benchmark, 21).available).toBe(false);
    expect(relativePerformance(history(15), benchmark, 21).available).toBe(false);
    expect(relativePerformance({ ...history(), adjustment: 'raw' }, benchmark, 21).available).toBe(false);
    expect(relativePerformance(history(), history(21), 21).available).toBe(false);
  });
  it('permits relative outperformance while both instruments fall and preserves stale flags', () => {
    const result = relativePerformance({ ...history(50, -.001), stale: true }, history(50, -.002), 21);
    expect(result.assetReturn).toBeLessThan(0);
    expect(result.excessPp).toBeGreaterThan(0);
    expect(result.stale).toBe(true);
  });
  it('computes 10/4-week normalized trails only from completed weeks', () => {
    const base = history(400, .001), stock = history(400, .002);
    const trail = rotationTrail(stock, base, '2026-06-05');
    expect(trail).toHaveLength(12);
    expect(trail.at(-1)!.date).toBe('2026-06-05');
    expect(trail.at(-1)!.x).toBeGreaterThan(100);
    for (const point of trail) expect(point.date <= '2026-06-05').toBe(true);
    const equal = rotationTrail(base, base, '2026-06-05');
    expect(equal.at(-1)).toMatchObject({ x: 100, y: 100, state: 'neutral' });
    stock.series = stock.series!.filter(p => p.date !== '2026-06-05');
    expect(rotationTrail(stock, base, '2026-06-05')).toEqual([]);
  });
  it('classifies all quadrants and leaves exact boundaries neutral', () => {
    expect(rotationState(101, 101)).toBe('leading'); expect(rotationState(101, 99)).toBe('weakening');
    expect(rotationState(99, 99)).toBe('lagging'); expect(rotationState(99, 101)).toBe('improving');
    expect(rotationState(100, 101)).toBe('neutral');
    expect(signedPercent(-.0001)).toBe('0.0%'); expect(signedPp(5)).toBe('+5.0 个百分点');
  });
});
