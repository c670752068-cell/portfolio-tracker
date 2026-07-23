import { describe, expect, it } from 'vitest';
import { computeIndexAnchor, computeStock5yMean } from './peBasis';

describe('computeStock5yMean', () => {
  it('computes the five-year arithmetic mean and current deviation', () => {
    const result = computeStock5yMean([
      { date: '2021-07-24', value: 20 },
      { date: '2023-07-22', value: 25 },
      { date: '2026-07-22', value: 30 },
    ], 20);

    expect(result.mean5y).toBe(25);
    expect(result.current).toBe(20);
    expect(result.deviationPct).toBe(-20);
    expect(result.sampleMonths).toBeGreaterThanOrEqual(24);
  });

  it('returns null values instead of NaN for an empty series', () => {
    expect(computeStock5yMean([], null)).toEqual({
      mean5y: null,
      current: null,
      deviationPct: null,
      sampleMonths: 0,
    });
  });
});

describe('computeIndexAnchor', () => {
  const series = [
    { date: '2025-04-08', value: 21.6 },
    { date: '2025-04-15', value: 22.1 },
    { date: '2025-05-01', value: 25 },
  ];
  const window = { start: '2025-04-01', end: '2025-04-30' };

  it('classifies 22.5 against a 21.6 anchor as at_anchor', () => {
    expect(computeIndexAnchor(series, 22.5, window)).toMatchObject({
      anchorPe: 21.6,
      anchorDate: '2025-04-08',
      current: 22.5,
      gapPct: 4.166667,
      zone: 'at_anchor',
    });
  });

  it('classifies 24.5 as near and 30 as far', () => {
    expect(computeIndexAnchor(series, 24.5, window).gapPct).toBe(13.425926);
    expect(computeIndexAnchor(series, 24.5, window).zone).toBe('near_anchor');
    expect(computeIndexAnchor(series, 30, window).zone).toBe('far');
  });

  it('prefers a manual anchor over the series minimum', () => {
    expect(computeIndexAnchor(series, 22.5, window, 20)).toMatchObject({
      anchorPe: 20,
      anchorDate: null,
      gapPct: 12.5,
      zone: 'near_anchor',
    });
  });

  it('uses configurable 3/10 distance thresholds', () => {
    const result = computeIndexAnchor(series, 22.5, window, 20, {
      atAnchorPct: 3,
      nearAnchorPct: 10,
    });

    expect(result.gapPct).toBe(12.5);
    expect(result.zone).toBe('far');
  });

  it('returns unknown for an empty series or a zero anchor without NaN', () => {
    const empty = computeIndexAnchor([], 22.5, window);
    const zero = computeIndexAnchor([{ date: '2025-04-08', value: 0 }], 22.5, window);

    expect(empty).toEqual({
      anchorPe: null,
      anchorDate: null,
      current: 22.5,
      gapPct: null,
      zone: 'unknown',
    });
    expect(zero.zone).toBe('unknown');
    expect(JSON.stringify([empty, zero])).not.toMatch(/NaN|Infinity/);
  });
});
