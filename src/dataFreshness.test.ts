import { describe, expect, it } from 'vitest';
import { dateCoverage, snapshotDataDates, sourceTime } from './dataFreshness';
import type { QuantAnalysisSnapshot } from './types';

describe('independent source timestamps', () => {
  it('does not replace old/missing source dates with the latest snapshot time', () => {
    const data = {
      generated_at: '2026-09-10T08:30:00-04:00', symbols: {
        AAPL: { historical_standard: { available_end: '2026-09-08' }, ma_slope: { as_of: '2026-09-09' } },
      },
      freshness: { prices_at: '2026-09-10T08:20:00-04:00', drawdown_generated_at: '2026-09-09T10:17:00-04:00' },
      pe_history: { symbols: { AAPL: { current: 30, series_end: '2026-09-07', series: [] } } },
    } as unknown as QuantAnalysisSnapshot;
    expect(snapshotDataDates(data)).toEqual({ market: '2026-09-10 08:20 ET', marketDaily: '2026-09-09', pe: '2026-09-07', history: '2026-09-08', historyGenerated: '2026-09-09 10:17 ET' });
    expect(snapshotDataDates({ generated_at: data.generated_at, symbols: {} } as QuantAnalysisSnapshot)).toEqual({
      market: '未提供', marketDaily: '未提供数据日期', pe: '未提供数据日期', history: '未提供数据日期', historyGenerated: '未提供',
    });
  });
  it('shows mixed source dates honestly and retains timezone/date-only meaning', () => {
    expect(dateCoverage(['2026-09-08', '2026-09-09', null])).toBe('2026-09-08 ～ 2026-09-09 · 部分日期未提供');
    expect(sourceTime('2026-09-10T01:00:00Z')).toBe('2026-09-09 21:00 ET');
    expect(sourceTime('2026-09-09')).toBe('2026-09-09');
    expect(sourceTime('2026-02-30')).toBe('未提供');
  });
});
