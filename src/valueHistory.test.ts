import { describe, expect, it } from 'vitest';
import { recordDailyValue, type ValuePoint } from './valueHistory';

describe('recordDailyValue', () => {
  it('overwrites the value for the same Beijing date', () => {
    expect(recordDailyValue([{ date: '2026-07-15', totalValueUsd: 100 }], '2026-07-15', 125)).toEqual([
      { date: '2026-07-15', totalValueUsd: 125 },
    ]);
  });

  it('appends a value for a different date', () => {
    expect(recordDailyValue([{ date: '2026-07-15', totalValueUsd: 100 }], '2026-07-16', 110)).toEqual([
      { date: '2026-07-15', totalValueUsd: 100 },
      { date: '2026-07-16', totalValueUsd: 110 },
    ]);
  });

  it('sorts points by date ascending', () => {
    expect(recordDailyValue([{ date: '2026-07-16', totalValueUsd: 110 }], '2026-07-15', 100).map((point) => point.date)).toEqual([
      '2026-07-15',
      '2026-07-16',
    ]);
  });

  it('retains only the newest 365 dates', () => {
    const history: ValuePoint[] = Array.from({ length: 365 }, (_, index) => ({
      date: `2025-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}`,
      totalValueUsd: index,
    }));
    const result = recordDailyValue(history, '2026-12-31', 999);

    expect(result).toHaveLength(365);
    expect(result.at(-1)).toEqual({ date: '2026-12-31', totalValueUsd: 999 });
    expect(result.some((point) => point.date === history[0].date)).toBe(false);
  });
});
