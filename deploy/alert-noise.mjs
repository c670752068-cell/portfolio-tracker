import { sessionLabel } from './realtime-alerts.mjs';

// 提醒降噪：状态类提醒（可买 / 低估值 / 极低估值）只在「刚进入」时单独记一行，
// 之后每天还在同一状态就并进一条汇总；同一标的同一类提醒还有冷却时间。
// 这里只决定「写不写日志」，不改推送开关，也不改任何买卖阈值。
export const STATUS_STATE_PREFIX = 'status:';
export const NOISE_CONFIG_FILE = 'alert-noise.config.json';
export const DEFAULT_NOISE_CONFIG = Object.freeze({
  cooldownMinutes: 60,
  importantBypassesCooldown: true,
});

// 状态类事件的 key 取前几段算「同一个状态」：
// 可买的第三段是当天的理由（会变），估值的第三段是档位（变了就是新状态）。
const STATUS_SEGMENTS = { valuation: 3, buy: 2 };
const CATEGORY_LABELS = {
  drawdown: '回撤', sentiment: '情绪', valuation: '估值', zscore: 'Z-Score',
  sell_line: '卖出线', position: '仓位', system: '系统', other: '其他',
};

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

export function loadNoiseConfig(raw) {
  const value = record(raw);
  const minutes = Number(value.cooldownMinutes);
  return {
    cooldownMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_NOISE_CONFIG.cooldownMinutes,
    importantBypassesCooldown: typeof value.importantBypassesCooldown === 'boolean'
      ? value.importantBypassesCooldown
      : DEFAULT_NOISE_CONFIG.importantBypassesCooldown,
  };
}

export function statusKeyOf(eventKey) {
  const parts = String(eventKey || '').split(':');
  const take = STATUS_SEGMENTS[parts[0]];
  if (!take || parts.length < take || parts.slice(0, take).some((part) => !part)) return null;
  return parts.slice(0, take).join(':');
}

/**
 * 同一个标的、同一类提醒在冷却时间内最多记一条。
 * 真的推送出去的那一条是推送记录，不拿它当冷却依据，也不会被它挡掉。
 */
export function withinCooldown(store, { symbol, category, now = new Date(), cooldownMs = 0 } = {}) {
  const ticker = String(symbol || '').toUpperCase();
  if (!ticker || !(cooldownMs > 0)) return false;
  const floor = +now - cooldownMs;
  return (record(store).alerts || []).some((raw) => {
    const item = record(raw);
    if (String(item.symbol || '').toUpperCase() !== ticker) return false;
    if (String(item.category || '') !== String(category || '')) return false;
    if (String(item.push_state || '') === 'sent' || item.voided === true) return false;
    const at = Date.parse(String(item.occurred_at || ''));
    return Number.isFinite(at) && at >= floor && at <= +now;
  });
}

/**
 * 一个推送时段写哪些日志行。
 * events 是这一轮真的派发过的事件，present 是当前全部状态（含本轮没再派发的），
 * 用来判断哪些状态已经离开。返回的 states 要存回提醒日志。
 */
export function planSlotEntries({
  store, events = [], present = null, now = new Date(), slot = '', session = 'closed',
} = {}) {
  const states = { ...record(store).states };
  const currentEvents = Array.isArray(present) ? present : events;
  const presentKeys = new Set(currentEvents.map((event) => statusKeyOf(record(event).key)).filter(Boolean));
  const kinds = new Set([...presentKeys].map((key) => key.split(':')[0]));
  // 本轮评估过的类别里，已经不在名单上的状态要清掉：下次再进入算新的一次。
  for (const key of Object.keys(states)) {
    if (!key.startsWith(STATUS_STATE_PREFIX)) continue;
    const statusKey = key.slice(STATUS_STATE_PREFIX.length);
    if (kinds.has(statusKey.split(':')[0]) && !presentKeys.has(statusKey)) delete states[key];
  }

  const tag = `[${sessionLabel(session)}]`;
  const entries = [];
  const repeats = new Map();
  for (const raw of events) {
    const event = record(raw);
    const category = String(event.category || 'other');
    const text = [event.title, event.body].filter(Boolean).join(' · ') || '推送';
    const statusKey = statusKeyOf(event.key);
    const stateKey = `${STATUS_STATE_PREFIX}${statusKey}`;
    const repeated = statusKey !== null && states[stateKey] === 'in';
    if (statusKey !== null) states[stateKey] = 'in';
    if (repeated) {
      if (!repeats.has(category)) repeats.set(category, []);
      repeats.get(category).push({ symbol: event.symbol ?? null, text });
      continue;
    }
    entries.push({
      dedupe_key: `push:${slot}:${event.key}`,
      category,
      symbol: event.symbol ?? null,
      icon: String(event.icon || '🔔'),
      text: `${tag} ${text}`,
      pushed: event.pushed === true,
      push_state: typeof event.push_state === 'string' ? event.push_state : null,
      session,
      occurred_at: typeof event.occurred_at === 'string' ? event.occurred_at : now.toISOString(),
    });
  }
  for (const [category, items] of repeats) {
    entries.push({
      dedupe_key: `summary:${slot}:${category}`,
      category,
      symbol: null,
      icon: '📋',
      text: `${tag} ${CATEGORY_LABELS[category] || '提醒'}汇总 · ${items.length} 个标的`,
      pushed: false,
      push_state: 'log_only',
      session,
      occurred_at: now.toISOString(),
      indicators: { level: 3 },
      summary_items: items,
    });
  }
  return { entries, states };
}
