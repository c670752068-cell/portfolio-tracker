import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { analyzeBreakouts, breakoutPushBatches } from './z-breakout.mjs';
import { analyzeExtreme, extremePushBatches } from './z-extreme.mjs';
import { knownTradingDate } from './market-session.mjs';

const TIME_ZONE = 'America/New_York';
const REVIEW_MINUTES = 16 * 60 + 20;
const RETRY_MINUTES = 30;
const WEEKENDS = new Set(['Sat', 'Sun']);
const FILE_NAME = 'channel-review.json';
const EXCLUDED_SYMBOLS = new Set(['CASH', 'USD', 'SGOV', 'BIL']);

export const CHANNEL_REVIEW_INTERVAL_MS = 60 * 1000;
export const CHANNEL_REVIEW_TIME = '16:20';

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function newYorkParts(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    weekday: parts.weekday || '',
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour || 0) * 60 + Number(parts.minute || 0),
  };
}

async function readJson(path, fallback) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return record(value);
  } catch {
    return fallback;
  }
}

async function atomicWriteJson(root, name, value) {
  await mkdir(root, { recursive: true });
  const target = join(root, name);
  const temporary = join(root, `.${name}-${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

function previousWeekday(dateKey) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  do {
    date.setUTCDate(date.getUTCDate() - 1);
  } while (knownTradingDate(date.toISOString().slice(0, 10)) === false);
  return date.toISOString().slice(0, 10);
}

export function channelReviewTargetDate(now) {
  const clock = newYorkParts(now);
  if (WEEKENDS.has(clock.weekday) || knownTradingDate(clock.dateKey) === false) return previousWeekday(clock.dateKey);
  if (clock.minutes < REVIEW_MINUTES) return previousWeekday(clock.dateKey);
  return clock.dateKey;
}

function dueForReview(now, state) {
  const targetDate = channelReviewTargetDate(now);
  if (state.review_date === targetDate && state.breakout_version === 1 && state.extreme_version === 1 && !state.failed_symbols?.length) return null;
  const lastAttempt = Date.parse(String(state.last_attempt_at || ''));
  return !Number.isFinite(lastAttempt) || now.getTime() - lastAttempt >= RETRY_MINUTES * 60 * 1000
    ? targetDate : null;
}

export function channelReviewSymbols(snapshot, positions = []) {
  const root = record(snapshot);
  const active = Array.isArray(record(root.growth_watchlist).active_symbols)
    ? root.growth_watchlist.active_symbols : [];
  const stored = Object.entries(record(root.symbols))
    .filter(([, value]) => Boolean(record(value).ma_slope))
    .map(([symbol]) => symbol);
  const held = positions.filter(p => p.asset_type !== 'option' && Number.isFinite(p.qty) && p.qty !== 0).map(p => p.symbol);
  return [...new Set([...active, ...stored, ...held, 'NDX', 'SOX', 'SPX'])]
    .map((symbol) => String(symbol || '').trim().toUpperCase().replace(/^US\./, ''))
    .filter((symbol) => (
      !EXCLUDED_SYMBOLS.has(symbol) && /^\^?[A-Z][A-Z0-9.-]{0,10}$/.test(symbol)
    ));
}

async function mapWithConcurrency(values, limit, task) {
  const result = [];
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      result[index] = await task(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return result;
}

export async function runChannelReviewCycle({
  now = new Date(), snapshot, positions = [], alertsRoot, fetchDashboard, notify = async () => {}, force = false,
  extremeRule = { positiveThreshold: 1.4, negativeThreshold: 1.4 },
}) {
  const path = join(alertsRoot, FILE_NAME);
  const previous = await readJson(path, {});
  const universe = channelReviewSymbols(snapshot, positions);
  const newlyTracked = universe.filter(symbol => !previous.breakouts?.[symbol]);
  const targetDate = force || newlyTracked.length ? channelReviewTargetDate(now) : dueForReview(now, previous);
  if (!targetDate) {
    return { skipped: true, review_date: previous.review_date || null, failed_symbols: [] };
  }
  const retryOnly = previous.breakout_version === 1 && previous.extreme_version === 1 && previous.breakout_date === targetDate && (previous.failed_symbols?.length || newlyTracked.length);
  const symbols = retryOnly ? [...new Set([...(previous.failed_symbols || []), ...newlyTracked, 'SPX', 'NDX'])] : universe;
  const reviewed = await mapWithConcurrency(symbols, 4, async (symbol) => {
    try {
      const dashboard = await fetchDashboard(symbol, now);
      const alert = dashboard?.dashboard?.channel_alert;
      if (!alert || typeof alert !== 'object') throw new Error('channel alert missing');
      return { symbol, alert, series: (dashboard.dashboard.series || []).map(({ date, zscore200, is_partial }) => ({ date, zscore200, is_partial })) };
    } catch (error) {
      return { symbol, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const nextSymbols = { ...record(previous.symbols) };
  const breakouts = { ...record(previous.breakouts) };
  const extremes = { ...record(previous.z_extremes) };
  const freshExtremes = [];
  const history = new Map((Array.isArray(previous.breakout_history) ? previous.breakout_history : []).map(e => [e.id, e]));
  const freshEvents = [];
  // Reference exchange sessions come from the two broad market indexes. For
  // covered calendar years explicitly include missing expected sessions too.
  const reference = reviewed.filter(item => ['SPX', 'NDX'].includes(item.symbol) && !item.error);
  const sessionSet = new Set(reference.flatMap(item => item.series.filter(p => !p.is_partial && p.date <= targetDate).map(p => p.date)));
  const referenceLatest = [...sessionSet].sort().at(-1);
  if (referenceLatest) {
    const cursor = new Date(`${[...sessionSet].sort()[0]}T12:00:00Z`);
    while (cursor.toISOString().slice(0, 10) <= referenceLatest) {
      const key = cursor.toISOString().slice(0, 10);
      if (knownTradingDate(key) === true) sessionSet.add(key);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  const failedSymbols = [];
  for (const item of reviewed) {
    if (item.error) {
      failedSymbols.push(item.symbol);
      if (nextSymbols[item.symbol]) nextSymbols[item.symbol] = { ...nextSymbols[item.symbol], stale: true };
      breakouts[item.symbol] = { status: 'unavailable', as_of: targetDate, event: null, reason: '日线读取失败，暂无法判断。', last_valid_as_of: previous.breakouts?.[item.symbol]?.last_valid_as_of ?? null };
      extremes[item.symbol] = { status: 'unavailable', as_of: targetDate, event: null, last_valid_as_of: previous.z_extremes?.[item.symbol]?.last_valid_as_of ?? null };
      continue;
    }
    nextSymbols[item.symbol] = {
      ...item.alert,
      reviewed_at: now.toISOString(),
      stale: false,
    };
    const result = analyzeBreakouts(item.symbol, item.series, [...sessionSet], targetDate);
    const { history: symbolHistory, ...status } = result;
    breakouts[item.symbol] = { ...status, last_valid_as_of: result.status === 'unavailable' ? previous.breakouts?.[item.symbol]?.last_valid_as_of ?? null : targetDate };
    const extreme = analyzeExtreme(item.symbol, item.series, [...sessionSet], targetDate, extremeRule);
    const lastExtremeDate = previous.z_extremes?.[item.symbol]?.last_valid_as_of;
    if (extreme.event && previous.extreme_version === 1 && lastExtremeDate && lastExtremeDate < targetDate) freshExtremes.push(extreme.event);
    extremes[item.symbol] = { ...extreme, last_valid_as_of: extreme.status === 'unavailable' ? lastExtremeDate ?? null : targetDate };
    for (const event of symbolHistory) {
      if (!history.has(event.id) && event.date === targetDate && previous.breakout_version === 1
        && (previous.breakouts?.[item.symbol]?.last_valid_as_of ?? previous.breakouts?.[item.symbol]?.as_of)
        && (previous.breakouts[item.symbol].last_valid_as_of ?? previous.breakouts[item.symbol].as_of) < event.date) freshEvents.push(event);
      history.set(event.id, event);
    }
  }
  const state = {
    review_time: CHANNEL_REVIEW_TIME,
    timezone: TIME_ZONE,
    review_date: failedSymbols.length === 0 ? targetDate : (previous.review_date || null),
    updated_at: now.toISOString(),
    last_attempt_at: now.toISOString(),
    failed_symbols: failedSymbols,
    symbols: nextSymbols,
    breakout_version: 1,
    extreme_version: 1,
    z_extremes: extremes,
    breakout_date: targetDate,
    breakouts,
    breakout_history: [...history.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-1000),
  };
  // Persist observations BEFORE sending. Restart/retry/quiet-hours/reenable do
  // not replay them, including a failed transport attempt. First upgrade only
  // establishes the baseline and history, never phone notifications.
  await atomicWriteJson(alertsRoot, FILE_NAME, state);
  const clock = newYorkParts(now);
  if (clock.dateKey === targetDate && clock.minutes >= REVIEW_MINUTES && clock.minutes < REVIEW_MINUTES + 60) {
    const occurredAt = new Date(+now - (clock.minutes - REVIEW_MINUTES) * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds()).toISOString();
    for (const event of breakoutPushBatches(freshEvents, now, occurredAt)) await notify(event);
    for (const event of extremePushBatches(freshExtremes, now, occurredAt)) await notify(event);
  }
  return { skipped: false, review_date: state.review_date, failed_symbols: failedSymbols, symbols: nextSymbols };
}

export async function readChannelReview(alertsRoot) {
  const value = await readJson(join(alertsRoot, FILE_NAME), {});
  return {
    review_time: CHANNEL_REVIEW_TIME,
    timezone: TIME_ZONE,
    review_date: value.review_date || null,
    updated_at: value.updated_at || null,
    failed_symbols: Array.isArray(value.failed_symbols) ? value.failed_symbols : [],
    symbols: record(value.symbols),
    breakout_date: value.breakout_date || null,
    breakouts: Object.fromEntries(Object.entries(record(value.breakouts)).map(([symbol, item]) => {
      // History is already returned once below; avoid sending it twice per poll.
      const { history: _history, ...status } = item;
      return [symbol, status];
    })),
    breakout_history: Array.isArray(value.breakout_history) ? value.breakout_history : [],
  };
}

export function createChannelReviewRoute({ alertsRoot, sendJson }) {
  return async function handleChannelReviewRoute(url, req, res) {
    if (url.pathname !== '/api/portfolio/channel-alerts') return false;
    if (req.method !== 'GET') {
      sendJson(res, 404, { error: { code: 'not_found', message: '未知接口' } });
      return true;
    }
    sendJson(res, 200, await readChannelReview(alertsRoot));
    return true;
  };
}
