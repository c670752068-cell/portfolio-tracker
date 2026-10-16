import type { QuantValuationTab } from './types';

const ONE_DAY_MS = 86_400_000;

export interface ValuationFreshness {
  asOf: string | null;
  tradingDaysOld: number | null;
  effectivelyStale: boolean;
}

export function normalizedValuationAsOf(
  ndx: QuantValuationTab['ndx'],
): string | null {
  if (!ndx.as_of) return null;
  // Danjuan publishes a date-only value at China midnight. The portfolio API
  // currently serializes that instant in US time, which moves it one calendar
  // day backwards (for example the published 07-31 value arrives as 07-30).
  return ndx.source.toLowerCase() === 'danjuanfunds'
    ? shiftDateOnly(ndx.as_of, 1)
    : ndx.as_of;
}

export function valuationFreshness(
  ndx: QuantValuationTab['ndx'],
  now = new Date(),
): ValuationFreshness {
  const asOf = normalizedValuationAsOf(ndx);
  const tradingDaysOld = tradingDaysSince(asOf, now);
  const rawUnavailable = ndx.stale === true || ndx.gate_available === false;
  const usableValue = ndx.available
    && ndx.current_pe !== null
    && Number.isFinite(ndx.current_pe);
  // Friday's daily valuation is the current decision value before Monday's
  // close. Weekends must not turn it into a four-day stale alarm.
  const recentDailyValue = usableValue
    && tradingDaysOld !== null
    && tradingDaysOld <= 1;

  return {
    asOf,
    tradingDaysOld,
    effectivelyStale: rawUnavailable && !recentDailyValue,
  };
}

function tradingDaysSince(asOf: string | null, now: Date): number | null {
  const start = parseDateOnly(asOf);
  const current = currentNewYorkDate(now);
  if (start === null || current === null) return null;
  if (start >= current) return 0;
  let days = 0;
  for (let cursor = start + ONE_DAY_MS; cursor <= current; cursor += ONE_DAY_MS) {
    const weekday = new Date(cursor).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

function shiftDateOnly(value: string, days: number): string {
  const parsed = parseDateOnly(value);
  if (parsed === null) return value;
  return new Date(parsed + days * ONE_DAY_MS).toISOString().slice(0, 10);
}

function parseDateOnly(value: string | null): number | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const parsed = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(parsed) ? parsed : null;
}

function currentNewYorkDate(now: Date): number | null {
  if (Number.isNaN(now.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const current = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Date.UTC(Number(current.year), Number(current.month) - 1, Number(current.day));
}
