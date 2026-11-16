import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { analyzeBreakouts, breakoutPushBatches } from './z-breakout.mjs';
import { analyzeExtreme, extremePushBatches } from './z-extreme.mjs';
import { knownTradingDate } from './market-session.mjs';

const TIME_ZONE = 'America/New_York';
const REVIEW_MINUTES = 16 * 60 + 20;
// 16:20 那一轮有时拿到的还不是最终收盘价（实测 NVDA 2026-10-30 差了约 0.7%，多记了一个假露头）。
// 18:00 再用最终收盘价完整复核一次：覆盖当天的 Z，补推 16:20 漏掉的事件，删掉不再成立的露头。
const FINAL_MINUTES = 18 * 60;
const RETRY_MINUTES = 30;
// 露头记录按最终价重新核对的范围：最近这么多天里、日线算不出来的露头会被删掉。
// 只看最近几天，免得某次日线临时缺一天就把很久以前的真实记录也删了。
const PRUNE_WINDOW_DAYS = 14;
const WEEKENDS = new Set(['Sat', 'Sun']);
const FILE_NAME = 'channel-review.json';
export const EXCLUDED_SYMBOLS = new Set(['CASH', 'USD', 'SGOV', 'BIL']);

export const CHANNEL_REVIEW_INTERVAL_MS = 60 * 1000;
export const CHANNEL_REVIEW_TIME = '16:20';
export const CHANNEL_CONFIRM_TIME = '18:00';

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

/** 这一轮算「最终价复核」吗：目标交易日美东 18:00 之后（含之后的任何一天）。 */
export function channelReviewIsFinal(now, targetDate) {
  const clock = newYorkParts(now);
  return clock.dateKey > targetDate || clock.minutes >= FINAL_MINUTES;
}

function retryAllowed(now, state) {
  const lastAttempt = Date.parse(String(state.last_attempt_at || ''));
  return !Number.isFinite(lastAttempt) || now.getTime() - lastAttempt >= RETRY_MINUTES * 60 * 1000;
}

function dueForReview(now, state) {
  const targetDate = channelReviewTargetDate(now);
  const final = channelReviewIsFinal(now, targetDate);
  const current = state.breakout_version === 1 && state.extreme_version === 1;
  if (final) {
    if (current && state.confirmed_date === targetDate) return null;
    // 最终价复核还没跑过：立刻跑；跑过但有失败：按原来的 30 分钟节奏重试
    if (current && state.final_attempt_date === targetDate && !retryAllowed(now, state)) return null;
    return targetDate;
  }
  if (state.review_date === targetDate && current && !state.failed_symbols?.length) return null;
  return retryAllowed(now, state) ? targetDate : null;
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
  const final = channelReviewIsFinal(now, targetDate);
  // 只重试失败 / 新加的标的：前提是同一阶段（16:20 或 18:00 最终价）已经对这一天完整跑过一次
  const sameStageRan = previous.breakout_date === targetDate && (!final || previous.final_attempt_date === targetDate);
  const retryOnly = previous.breakout_version === 1 && previous.extreme_version === 1 && sameStageRan && (previous.failed_symbols?.length || newlyTracked.length);
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
  const droppedEvents = [];
  // 旧版本留下的假露头（比如按非最终价记下的）第一次升级时全量清一遍，之后只核对最近几天。
  const fullPrune = previous.history_pruned !== true;
  const pruneFrom = new Date(`${targetDate}T12:00:00Z`);
  pruneFrom.setUTCDate(pruneFrom.getUTCDate() - PRUNE_WINDOW_DAYS);
  const recentFrom = pruneFrom.toISOString().slice(0, 10);
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
      final_close: final,
      stale: false,
    };
    const result = analyzeBreakouts(item.symbol, item.series, [...sessionSet], targetDate);
    const { history: symbolHistory, ...status } = result;
    breakouts[item.symbol] = { ...status, last_valid_as_of: result.status === 'unavailable' ? previous.breakouts?.[item.symbol]?.last_valid_as_of ?? null : targetDate };
    const extreme = analyzeExtreme(item.symbol, item.series, [...sessionSet], targetDate, extremeRule);
    const previousExtreme = previous.z_extremes?.[item.symbol];
    const lastExtremeDate = previousExtreme?.last_valid_as_of;
    // 16:20：这一天第一次看到就推。18:00 最终价：只推 16:20 没推过的（同一个事件 id 不重复推）。
    const extremeIsNew = final
      ? previousExtreme?.event?.id !== extreme.event?.id || (lastExtremeDate ?? '') < targetDate
      : (lastExtremeDate ?? '') < targetDate;
    if (extreme.event && previous.extreme_version === 1 && lastExtremeDate && extremeIsNew) freshExtremes.push(extreme.event);
    extremes[item.symbol] = { ...extreme, last_valid_as_of: extreme.status === 'unavailable' ? lastExtremeDate ?? null : targetDate };
    const previousBreakout = previous.breakouts?.[item.symbol];
    const baseline = previousBreakout?.last_valid_as_of ?? previousBreakout?.as_of;
    for (const event of symbolHistory) {
      if (!history.has(event.id) && event.date === targetDate && previous.breakout_version === 1
        && baseline && (final ? baseline <= event.date : baseline < event.date)) freshEvents.push(event);
      history.set(event.id, event);
    }
    // 按这次（最终价优先）的日线重新算出来不存在的露头，从记录里删掉，图上就不会留假箭头。
    // 只核对「之前那段连续同号的天数完整落在这次日线里」的露头：日线窗口最前面那些，
    // 前面的连续天数已经滑出窗口，这次本来就认不出来，不能因此当成假的删掉。
    if (result.status !== 'unavailable') {
      const kept = new Set(symbolHistory.map(event => event.id));
      const covered = symbolHistory.length >= 50 ? symbolHistory[0].date : '';
      const from = fullPrune ? covered : (covered > recentFrom ? covered : recentFrom);
      const position = new Map(item.series.filter(p => !p.is_partial).map((p, index) => [p.date, index]));
      for (const [id, event] of history) {
        if (event.symbol !== item.symbol || event.date < from || event.date > targetDate || kept.has(id)) continue;
        const index = position.get(event.date);
        // 前面要有至少 sessions 根日线（下标 0 ~ index-1），连续天数才完整落在窗口里
        if (index === undefined || index < Number(event.sessions || 0)) continue;
        history.delete(id);
        droppedEvents.push(event);
      }
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
    confirm_time: CHANNEL_CONFIRM_TIME,
    // 最终价复核完整跑通（没有失败）的交易日
    confirmed_date: final && failedSymbols.length === 0 ? targetDate : (previous.confirmed_date || null),
    final_attempt_date: final ? targetDate : (previous.final_attempt_date || null),
    history_pruned: previous.history_pruned === true || (fullPrune && failedSymbols.length === 0),
  };
  // Persist observations BEFORE sending. Restart/retry/quiet-hours/reenable do
  // not replay them, including a failed transport attempt. First upgrade only
  // establishes the baseline and history, never phone notifications.
  await atomicWriteJson(alertsRoot, FILE_NAME, state);
  const clock = newYorkParts(now);
  // 只在各自时间点之后一小时内推送；服务器很晚才补跑的，只更新记录，不推过时的消息。
  const windowStart = final ? FINAL_MINUTES : REVIEW_MINUTES;
  if (clock.dateKey === targetDate && clock.minutes >= windowStart && clock.minutes < windowStart + 60) {
    const occurredAt = new Date(+now - (clock.minutes - windowStart) * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds()).toISOString();
    for (const event of breakoutPushBatches(freshEvents, now, occurredAt)) await notify(event);
    for (const event of extremePushBatches(freshExtremes, now, occurredAt)) await notify(event);
  }
  return {
    skipped: false, final, review_date: state.review_date, confirmed_date: state.confirmed_date,
    failed_symbols: failedSymbols, symbols: nextSymbols, dropped_events: droppedEvents,
  };
}

export async function readChannelReview(alertsRoot) {
  const value = await readJson(join(alertsRoot, FILE_NAME), {});
  return {
    review_time: CHANNEL_REVIEW_TIME,
    timezone: TIME_ZONE,
    review_date: value.review_date || null,
    confirm_time: CHANNEL_CONFIRM_TIME,
    confirmed_date: value.confirmed_date || null,
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
