import { describe, it, expect } from 'vitest';
import { analyzeBreakouts, breakoutPushBatches } from './z-breakout.mjs';
import { knownTradingDate } from './market-session.mjs';

const dates: string[] = [];
for (let day = new Date('2026-08-17T12:00:00Z'); dates.length < 30; day = new Date(+day + 86400000)) {
  const date = day.toISOString().slice(0, 10); if (knownTradingDate(date)) dates.push(date);
}
const series = (zs: (number | null)[]) => zs.map((zscore200, i) => ({ date: dates[i], zscore200, is_partial: false }));
const analyze = (zs: (number | null)[]) => analyzeBreakouts('AMZN', series(zs), dates, dates[zs.length - 1]);
describe('closed Z-score zero crossing', () => {
  it('requires 15 preceding sessions, not 15 including the crossing', () => {
    expect(analyze([...Array(14).fill(0.08), -0.04]).event).toBeNull();
    expect(analyze([...Array(15).fill(0.08), -0.04]).event).toMatchObject({ direction: 'down', sessions: 15, previous_z: 0.08, z: -0.04, confirmed: true });
    expect(analyze([...Array(18).fill(-0.02), 0.01]).event).toMatchObject({ direction: 'up', sessions: 18 });
  });
  it('zero and missing sessions break runs; weekend and Labor Day do not count', () => {
    expect(dates).not.toContain('2026-09-07');
    expect(analyze([...Array(15).fill(0.08), 0, -0.04]).event).toBeNull();
    expect(analyze([...Array(15).fill(0.08), null, -0.04]).event).toBeNull();
    const points = series([...Array(18).fill(0.1), -0.04]).filter((_, i) => i !== 10);
    expect(analyzeBreakouts('AMZN', points, dates, dates[18]).event).toBeNull();
  });
  it('rejects null, NaN, partial, stale reference, duplicate dates and absent history', () => {
    for (const value of [null, NaN]) expect(analyze([...Array(15).fill(1), value]).status).toBe('unavailable');
    const points = series([...Array(15).fill(1), -0.04]); points[15].is_partial = true;
    expect(analyzeBreakouts('AMZN', points, dates, dates[15]).event).toBeNull();
    expect(analyzeBreakouts('AMZN', points, dates.slice(0, 15), dates[15]).status).toBe('unavailable');
    expect(analyzeBreakouts('AMZN', [points[0], ...Array(18).fill(points[0]), { date: dates[1], zscore200: -1 }], dates, dates[1]).event).toBeNull();
    expect(analyzeBreakouts('AMZN', [], [], dates[15]).status).toBe('unavailable');
  });
  it('a historical crossing is retained but not repeated as the current event', () => {
    const result = analyze([...Array(15).fill(0.1), -0.04, -0.08]);
    expect(result.event).toBeNull(); expect(result.history).toHaveLength(1);
    expect(result.status).toBe('none');
  });
  it('batches each direction with stable event identities and clear non-trade text', () => {
    const event = analyze([...Array(15).fill(0.08), -0.04]).event;
    const result = breakoutPushBatches([event, { ...event, symbol: 'MSFT', id: `MSFT:${event.date}:down` }], new Date('2026-09-16T20:20:00Z'), '2026-09-16T20:20:00Z');
    expect(result).toHaveLength(1); expect(result[0].title).toContain('2 个标的');
    expect(result[0].body).toContain('不等于买卖'); expect(result[0].direction).toBe('down');
  });
});
