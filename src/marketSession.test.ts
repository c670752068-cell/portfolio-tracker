import { describe, expect, it } from 'vitest';
import {
  MARKET_SESSION_REFRESH_MS,
  dayChangeSessionText,
  isRegularSession,
  marketSessionDateKey,
  sessionLabel,
} from './marketSession';

describe('US regular market session', () => {
  it('recognizes the 09:30 New York open during daylight saving time', () => {
    expect(isRegularSession(new Date('2026-07-15T13:29:59.000Z'))).toBe(false);
    expect(isRegularSession(new Date('2026-07-15T13:30:00.000Z'))).toBe(true);
  });

  it('recognizes the 09:30 New York open during standard time', () => {
    expect(isRegularSession(new Date('2026-01-15T14:29:59.000Z'))).toBe(false);
    expect(isRegularSession(new Date('2026-01-15T14:30:00.000Z'))).toBe(true);
  });

  it('freezes automatic updates at the 16:00 New York close and labels the value closed', () => {
    const beforeClose = new Date('2026-07-15T19:59:59.000Z');
    const atClose = new Date('2026-07-15T20:00:00.000Z');
    expect(isRegularSession(beforeClose)).toBe(true);
    expect(isRegularSession(atClose)).toBe(false);
    expect(sessionLabel(atClose)).toBe('已收盘');
  });

  it('never treats a New York weekend as an automatic refresh window', () => {
    const saturdayNoon = new Date('2026-07-18T16:00:00.000Z');
    expect(isRegularSession(saturdayNoon)).toBe(false);
    expect(sessionLabel(saturdayNoon)).toBe('周末');
  });

  it('produces honest day-change labels and discloses option estimates', () => {
    expect(dayChangeSessionText(
      new Date('2026-07-15T15:05:00.000Z'),
      '2026-07-15T15:04:00.000Z',
      1,
    )).toBe('盘中 11:04 更新 · 含 1 个期权估算');
    expect(dayChangeSessionText(new Date('2026-07-15T12:00:00.000Z'), null, 0))
      .toBe('上一交易日（未开盘）');
    expect(dayChangeSessionText(new Date('2026-07-18T16:00:00.000Z'), null, 0))
      .toBe('周末 · 显示周五冻结值');
  });

  it('uses the New York trading date and the fixed 35-minute cadence', () => {
    expect(marketSessionDateKey(new Date('2026-07-16T01:00:00.000Z'))).toBe('2026-07-15');
    expect(MARKET_SESSION_REFRESH_MS).toBe(35 * 60 * 1000);
  });
});
