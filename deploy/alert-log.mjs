import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// 提醒日志：网站每发出一次提醒就记一行，永久保存。只追加，不覆盖；
// 同一个提醒在同一轮里只记一次，靠调用方给的 dedupe_key 去重。
export const ALERT_LOG_FILE = 'alert-log.json';
export const ALERT_LOG_VERSION = 1;
export const QQQ_DRAWDOWN_TIERS = [5, 10, 15, 20, 25, 30];
const CATEGORIES = ['drawdown', 'sentiment', 'valuation', 'zscore', 'sell_line', 'position', 'system', 'other'];

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function numeric(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function emptyAlertLog() {
  // states 记每条阈值线、每个卖出军令当前是「触发」还是「正常」，
  // 只有状态翻转时才写日志，价格来回波动不会刷屏。
  return { version: ALERT_LOG_VERSION, updated_at: null, states: {}, alerts: [] };
}

export function normalizeAlertLog(value) {
  const store = record(value);
  return {
    version: ALERT_LOG_VERSION,
    updated_at: typeof store.updated_at === 'string' ? store.updated_at : null,
    states: record(store.states),
    alerts: rows(store.alerts).filter((item) => typeof record(item).dedupe_key === 'string'),
  };
}

/**
 * 按状态变化记日志：readings 里每项是 { key, state: 'triggered' | 'normal', ... }。
 * 只有和上次记下的状态不同才写一行；第一次见到「正常」只记状态、不写日志，
 * 免得刚上线就刷一堆「恢复正常」。
 */
export function applyStateAlerts(store, readings, now = new Date()) {
  const current = normalizeAlertLog(store);
  const states = { ...current.states };
  const entries = [];
  for (const reading of rows(readings)) {
    const item = record(reading);
    const key = String(item.key || '');
    const state = item.state === 'triggered' ? 'triggered' : 'normal';
    if (!key) continue;
    const previous = states[key];
    if (previous === state) continue;
    states[key] = state;
    if (previous === undefined && state === 'normal') continue;
    entries.push({
      dedupe_key: `state:${key}:${state}:${now.toISOString()}`,
      category: item.category,
      symbol: item.symbol,
      icon: item.icon,
      text: item.text,
      value: item.value,
      threshold: item.threshold,
      pushed: item.pushed === true,
      session: item.session,
      occurred_at: typeof item.occurred_at === 'string' ? item.occurred_at : now.toISOString(),
    });
  }
  const appended = appendAlerts({ ...current, states }, entries, now);
  const addedAlerts = appended.alerts.length !== current.alerts.length;
  const stateChanged = JSON.stringify(states) !== JSON.stringify(current.states);
  if (!addedAlerts && !stateChanged) return store;
  return { ...appended, states, updated_at: now.toISOString() };
}

/** 追加提醒；已经记过的 dedupe_key 直接跳过。没有新条目就原样返回。 */
export function appendAlerts(store, entries, now = new Date()) {
  const current = normalizeAlertLog(store);
  const known = new Set(current.alerts.map((item) => item.dedupe_key));
  const added = [];
  for (const entry of rows(entries)) {
    const item = record(entry);
    const key = String(item.dedupe_key || '');
    const text = String(item.text || '');
    const category = CATEGORIES.includes(item.category) ? item.category : 'other';
    if (!key || !text || known.has(key)) continue;
    known.add(key);
    added.push({
      id: `alert-${randomBytes(6).toString('hex')}`,
      dedupe_key: key,
      occurred_at: typeof item.occurred_at === 'string' && !Number.isNaN(Date.parse(item.occurred_at))
        ? new Date(item.occurred_at).toISOString()
        : now.toISOString(),
      category,
      symbol: typeof item.symbol === 'string' && item.symbol ? item.symbol.toUpperCase() : null,
      icon: String(item.icon || '•'),
      text,
      value: numeric(item.value),
      threshold: numeric(item.threshold),
      pushed: item.pushed === true,
      // 「到底有没有发出去」：sent / quiet_hours / 其他拦下的原因，日志里照实写
      push_state: typeof item.push_state === 'string' ? item.push_state : null,
      push_repeat: numeric(item.push_repeat),
      backfilled: item.backfilled === true,
      session: typeof item.session === 'string' ? item.session : null,
      indicators: item.indicators && typeof item.indicators === 'object' ? item.indicators : null,
      // 合并进汇总行的明细；普通提醒没有就留空，不编一个空数组
      summary_items: Array.isArray(item.summary_items) ? item.summary_items : null,
    });
  }
  if (added.length === 0) return store;
  return {
    ...current,
    alerts: [...current.alerts, ...added].sort((left, right) => left.occurred_at.localeCompare(right.occurred_at)),
    updated_at: now.toISOString(),
  };
}

/**
 * 推送事件归到哪个筛选分类。「可买」走回撤，「低估值」走估值，
 * 这样日志页的筛选和决策日志的关联都能用同一套分类。
 */
export function alertCategoryForEvent(event) {
  const key = `${String(event?.key || '')} ${String(event?.title || '')}`;
  if (/drawdown|回撤|深回撤|可买/.test(key)) return 'drawdown';
  if (/cnn|vix|恐慌|情绪/i.test(key)) return 'sentiment';
  if (/pe|估值/i.test(key)) return 'valuation';
  if (/z|通道|露头/i.test(key)) return 'zscore';
  if (/sell|卖出|止盈/i.test(key)) return 'sell_line';
  if (/仓位|预算|杠杆|期权/.test(key)) return 'position';
  return 'other';
}

/** 推送事件自己不带标的，标的写在 key 的第二段里（buy:NKE:…、valuation:AVGO:low）。 */
export function symbolFromEventKey(event) {
  if (typeof event?.symbol === 'string' && event.symbol) return event.symbol.toUpperCase();
  // Z 阈值提醒这类事件没有 key，只有 dedupeKey；一次提醒多个标的时不猜。
  const key = String(event?.key || event?.dedupeKey || '');
  if (key.includes('|')) return null;
  const candidate = String(key.split(':')[1] || '').toUpperCase();
  return /^[A-Z][A-Z0-9.]{0,5}$/.test(candidate) ? candidate : null;
}

/**
 * 把写错的提醒标成「已作废」。只加标记，不删任何一行，也不改原文。
 * 命中不到任何 dedupe_key 时原样返回，避免白写一次盘。
 */
export function voidAlerts(store, { dedupeKeys = [], ids = [], reason = '' } = {}, now = new Date()) {
  const current = normalizeAlertLog(store);
  const keys = new Set(rows(dedupeKeys).map((value) => String(value)));
  const identifiers = new Set(rows(ids).map((value) => String(value)));
  let changed = false;
  const alerts = current.alerts.map((item) => {
    if (item.voided === true) return item;
    if (!keys.has(String(item.dedupe_key)) && !identifiers.has(String(item.id))) return item;
    changed = true;
    return {
      ...item, voided: true, voided_reason: String(reason || ''), voided_at: now.toISOString(),
    };
  });
  if (!changed) return store;
  return { ...current, alerts, updated_at: now.toISOString() };
}

/**
 * 推送重试有了结论之后，把日志里那一行的状态改掉（只改状态，不动原文、不删行）。
 * dedupeKey 是推送事件的去重键，日志行的键是它加 push: 前缀。
 */
export function setPushState(store, dedupeKey, pushState, { repeat = null } = {}) {
  const current = normalizeAlertLog(store);
  const target = `push:${String(dedupeKey || '')}`;
  let changed = false;
  const alerts = current.alerts.map((item) => {
    if (String(item.dedupe_key) !== target || item.push_state === pushState) return item;
    changed = true;
    return {
      ...item,
      push_state: pushState,
      pushed: pushState === 'sent',
      ...(repeat === null ? {} : { push_repeat: numeric(repeat) }),
    };
  });
  if (!changed) return store;
  return { ...current, alerts, updated_at: new Date().toISOString() };
}

/** 日志里最后一条带数值的 CNN 记录，用来给重启后的实时监控补上起点。 */
export function lastKnownCnnScore(store) {
  const current = normalizeAlertLog(store);
  for (let index = current.alerts.length - 1; index >= 0; index -= 1) {
    const item = current.alerts[index];
    if (String(item.symbol || '').toUpperCase() !== 'CNN') continue;
    const value = numeric(item.value);
    if (value !== null) return value;
  }
  return null;
}

/**
 * QQQ 离前高的回撤按收盘价首次跌破各档位时各给一条；创新高时给一条
 * 「本轮回撤结束」，各档随之重置。一轮用那一轮前高的日期做 dedupe_key，
 * 所以同一轮里每档只会记一次。
 */
export function qqqDrawdownEvents(series, { from = null, liveFiredTiers = new Set() } = {}) {
  const closes = rows(series)
    .filter((point) => typeof point?.date === 'string' && numeric(point.close) !== null && Number(point.close) > 0)
    .map((point) => ({ date: point.date, close: Number(point.close) }))
    .sort((left, right) => left.date.localeCompare(right.date));
  if (closes.length < 2) return [];

  const events = [];
  let peak = closes[0].close;
  let peakDate = closes[0].date;
  let firedTiers = new Set();
  let deepest = 0;
  let deepestDate = null;

  for (const point of closes.slice(1)) {
    if (point.close >= peak) {
      if (firedTiers.size > 0) {
        const days = Math.round((Date.parse(point.date) - Date.parse(peakDate)) / 86_400_000);
        events.push({
          kind: 'recovered',
          dedupe_key: `qqq-drawdown-end:${peakDate}`,
          category: 'drawdown',
          symbol: 'QQQ',
          icon: '✅',
          date: point.date,
          value: deepest,
          threshold: null,
          text: `QQQ 回到前高 · 本轮回撤结束（最深 ${deepest.toFixed(1)}%，持续 ${days} 天）`,
        });
      }
      peak = point.close;
      peakDate = point.date;
      firedTiers = new Set();
      deepest = 0;
      deepestDate = null;
      continue;
    }
    const drawdown = (point.close / peak - 1) * 100;
    if (drawdown < deepest) {
      deepest = drawdown;
      deepestDate = point.date;
    }
    for (const tier of QQQ_DRAWDOWN_TIERS) {
      if (firedTiers.has(tier) || drawdown > -tier) continue;
      firedTiers.add(tier);
      // 盘中已经报过同一档时，收盘这条是确认而不是「首次跌破」。
      const confirmation = liveFiredTiers.has(`${tier}:${peakDate}`);
      events.push({
        kind: confirmation ? 'tier_confirm' : 'tier',
        tier,
        dedupe_key: confirmation
          ? `qqq-drawdown-confirm:${tier}:${peakDate}`
          : `qqq-drawdown:${tier}:${peakDate}`,
        category: 'drawdown',
        symbol: 'QQQ',
        icon: '📉',
        date: point.date,
        value: drawdown,
        threshold: -tier,
        text: confirmation
          ? `[收盘确认] QQQ 收盘 ${point.close.toFixed(2)} · 离前高 ${drawdown.toFixed(2)}% · 仍在 -${tier}% 档`
          : `QQQ 回撤 ${drawdown.toFixed(2)}%（前高 ${peak.toFixed(2)} → 收盘 ${point.close.toFixed(2)}）· 本轮首次跌破 -${tier}%`,
      });
    }
  }
  void deepestDate;
  return from ? events.filter((event) => event.date >= from) : events;
}

export async function readAlertLog(root) {
  try {
    return normalizeAlertLog(JSON.parse(await readFile(join(root, ALERT_LOG_FILE), 'utf8')));
  } catch {
    return emptyAlertLog();
  }
}

export async function writeAlertLog(root, store) {
  await mkdir(root, { recursive: true });
  const target = join(root, ALERT_LOG_FILE);
  const temporary = join(root, `.${ALERT_LOG_FILE}-${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** 提醒日志只读；隐藏已读在浏览器本机做，服务器永远不删记录。 */
export function createAlertLogRoute({ root, sendJson }) {
  return async function handleAlertLogRoute(url, req, res) {
    if (url.pathname !== '/api/portfolio/alert-log') return false;
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: { code: 'method_not_allowed', message: '提醒日志只读' } });
      return true;
    }
    sendJson(res, 200, { log: await readAlertLog(root) });
    return true;
  };
}
