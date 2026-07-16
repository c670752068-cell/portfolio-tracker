const NEW_YORK_TIME_ZONE = 'America/New_York';
const REGULAR_OPEN_MINUTES = 9 * 60 + 30;
const REGULAR_CLOSE_MINUTES = 16 * 60;
const WEEKEND_DAYS = new Set(['Sat', 'Sun']);
const MARKET_SESSION_REFRESH_MINUTES = 35;

export const MARKET_SESSION_REFRESH_MS = MARKET_SESSION_REFRESH_MINUTES * 60 * 1000;

interface NewYorkClock {
  weekday: string;
  minutes: number;
}

export type MarketSessionLabel = '盘中' | '已收盘' | '未开盘' | '周末';

export function isRegularSession(date: Date): boolean {
  const clock = newYorkClock(date);
  return !WEEKEND_DAYS.has(clock.weekday)
    && clock.minutes >= REGULAR_OPEN_MINUTES
    && clock.minutes < REGULAR_CLOSE_MINUTES;
}

export function sessionLabel(date: Date): MarketSessionLabel {
  const clock = newYorkClock(date);
  if (WEEKEND_DAYS.has(clock.weekday)) return '周末';
  if (clock.minutes < REGULAR_OPEN_MINUTES) return '未开盘';
  if (clock.minutes >= REGULAR_CLOSE_MINUTES) return '已收盘';
  return '盘中';
}

export function marketSessionDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NEW_YORK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function dayChangeSessionText(
  date: Date,
  lastSyncedAt: string | null,
  deltaEstimatedCount: number,
): string {
  const label = sessionLabel(date);
  let text: string;
  if (label === '盘中') {
    const syncedAt = lastSyncedAt ? new Date(lastSyncedAt) : null;
    text = syncedAt && Number.isFinite(syncedAt.getTime())
      ? `盘中 ${formatNewYorkTime(syncedAt)} 更新`
      : '盘中';
  } else if (label === '未开盘') {
    text = '上一交易日（未开盘）';
  } else if (label === '周末') {
    text = '周末 · 显示周五冻结值';
  } else {
    text = '已收盘';
  }
  return deltaEstimatedCount > 0 ? `${text} · 含 ${deltaEstimatedCount} 个期权估算` : text;
}

function newYorkClock(date: Date): NewYorkClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NEW_YORK_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    weekday: values.weekday ?? '',
    minutes: Number(values.hour ?? 0) * 60 + Number(values.minute ?? 0),
  };
}

function formatNewYorkTime(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: NEW_YORK_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}
