import { describe, expect, it } from 'vitest';
import { staleDaysFrom } from './staleDays';

describe('staleDaysFrom', () => {
  it('uses calendar-day distance instead of a conflicting server stale count', () => {
    expect(staleDaysFrom('2026-07-28', new Date('2026-07-30T08:49:00-04:00'))).toBe(2);
  });
});
