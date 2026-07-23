import { describe, expect, it, vi } from 'vitest';

import { classifyMarketSession } from './market-session.mjs';

describe('classifyMarketSession', () => {
  it.each([
    ['盘前 09:20 EDT', '2026-07-23T13:20:00Z', 'pre'],
    ['盘中 10:00 EDT', '2026-07-23T14:00:00Z', 'regular'],
    ['盘后 16:30 EDT', '2026-07-23T20:30:00Z', 'post'],
    ['夜盘 22:00 EDT', '2026-07-24T02:00:00Z', 'overnight'],
    ['周六 10:00', '2026-07-25T14:00:00Z', 'closed'],
    ['冬令时 09:35 EST', '2026-01-15T14:35:00Z', 'regular'],
    ['感恩节 10:00', '2026-11-26T15:00:00Z', 'closed'],
    ['半日市 14:00', '2026-11-27T19:00:00Z', 'post'],
    ['平安夜 12:30', '2026-12-24T17:30:00Z', 'regular'],
  ])('%s → %s', (_label, instant, expected) => {
    expect(classifyMarketSession(new Date(instant), { hasMinuteSeries: true })).toBe(expected);
  });

  it.each([
    ['09:29:59', '2026-07-23T13:29:59Z', 'pre'],
    ['09:30:00', '2026-07-23T13:30:00Z', 'regular'],
    ['15:59:59', '2026-07-23T19:59:59Z', 'regular'],
    ['16:00:00', '2026-07-23T20:00:00Z', 'post'],
    ['19:59:59', '2026-07-23T23:59:59Z', 'post'],
    ['20:00:00', '2026-07-24T00:00:00Z', 'overnight'],
    ['半日市 12:59:59', '2026-11-27T17:59:59Z', 'regular'],
    ['半日市 13:00:00', '2026-11-27T18:00:00Z', 'post'],
    ['半日市 16:59:59', '2026-11-27T21:59:59Z', 'post'],
    ['半日市 17:00:00', '2026-11-27T22:00:00Z', 'overnight'],
  ])('uses left-closed, right-open boundary at %s', (_label, instant, expected) => {
    expect(classifyMarketSession(new Date(instant), { hasMinuteSeries: true })).toBe(expected);
  });

  it('uses Yahoo currentTradingPeriod before the local fallback table', () => {
    const instant = new Date('2026-07-24T02:00:00Z');
    const unix = Math.floor(instant.getTime() / 1000);

    expect(classifyMarketSession(instant, {
      hasMinuteSeries: true,
      currentTradingPeriod: {
        regular: { start: unix - 60, end: unix + 60 },
      },
    })).toBe('regular');
  });

  it('treats an empty minute series as closed before using the local table', () => {
    expect(classifyMarketSession(new Date('2026-07-23T14:00:00Z'), {
      hasMinuteSeries: false,
    })).toBe('closed');
  });

  it('degrades to weekend plus local hours and logs when the holiday table is outdated', () => {
    const logger = vi.fn();

    expect(classifyMarketSession(new Date('2028-07-10T14:00:00Z'), {
      hasMinuteSeries: true,
      logger,
    })).toBe('regular');
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('2028'));
  });

  it('distinguishes a half day from a normal day at the same local time', () => {
    expect(classifyMarketSession(new Date('2026-11-27T19:00:00Z'), {
      hasMinuteSeries: true,
    })).toBe('post');
    expect(classifyMarketSession(new Date('2026-07-23T18:00:00Z'), {
      hasMinuteSeries: true,
    })).toBe('regular');
  });
});
