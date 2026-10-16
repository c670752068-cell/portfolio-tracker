import { describe, expect, it } from 'vitest';
import type { QuantValuationTab } from './types';
import { valuationFreshness } from './valuationFreshness';

function ndx(overrides: Partial<QuantValuationTab['ndx']> = {}): QuantValuationTab['ndx'] {
  return {
    available: true,
    current_pe: 29.9797,
    current_pb: 9.2752,
    pe_percentile_5y: 22.18,
    zone: '适中',
    percentile_lines: { p30: 29, median: 31, p70: 34 },
    history: [],
    source: 'danjuanfunds',
    as_of: '2026-07-30',
    stale: true,
    stale_days: 8,
    gate_available: false,
    realtime_estimate: null,
    ...overrides,
  };
}

describe('valuationFreshness', () => {
  it('corrects the Danjuan date offset and ignores a weekend-only stale alarm', () => {
    expect(valuationFreshness(
      ndx(),
      new Date('2026-08-03T01:49:59-04:00'),
    )).toEqual({
      asOf: '2026-07-31',
      tradingDaysOld: 1,
      effectivelyStale: false,
    });
  });

  it('keeps the warning for genuinely old Danjuan data', () => {
    expect(valuationFreshness(
      ndx({ as_of: '2026-07-24' }),
      new Date('2026-08-03T01:49:59-04:00'),
    )).toEqual({
      asOf: '2026-07-25',
      tradingDaysOld: 6,
      effectivelyStale: true,
    });
  });
});
