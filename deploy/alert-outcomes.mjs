import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { etParts } from './market-session.mjs';

// 提醒效果：每条带标的的提醒，按收盘价算之后第 1 / 5 / 20 个交易日的涨跌，
// 以及同期 QQQ 的涨跌（超额收益）。每天收盘后在服务器上算一次并存盘，
// 网页只读结果，不自己重算。这里只统计，不改任何阈值，也不产生提醒。
export const ALERT_OUTCOMES_FILE = 'alert-outcomes.json';
export const ALERT_OUTCOMES_VERSION = 1;
export const OUTCOME_HORIZONS = [1, 5, 20];
export const MIN_RELIABLE_SAMPLES = 10;
// 「可买 / 低估值」连续多天还在同一状态只算第一次：间隔超过这么多天才算新的一次。
export const VALUATION_RUN_GAP_DAYS = 7;
export const UNRELIABLE_NOTE = '样本太少，结论不可靠';

// 统计里的九类。没列进来的（0.5 档穿越、回升、持仓变化、系统提醒）不统计。
export const OUTCOME_KINDS = [
  'qqq_drawdown', 'vix_spike', 'cnn_fear', 'z_enter', 'z_cross_1',
  'big_move', 'sell_line', 'resonance', 'valuation_buy',
];
export const OUTCOME_KIND_LABELS = {
  qqq_drawdown: 'QQQ 回撤档位',
  vix_spike: 'VIX 飙升',
  cnn_fear: 'CNN 恐慌',
  z_enter: 'Z 进入 ±1.5',
  z_cross_1: 'Z 穿过 ±1.0',
  big_move: '个股大涨大跌',
  sell_line: '卖出线',
  resonance: '多指标共振',
  valuation_buy: '可买 / 低估值',
};

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function finite(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** 这条提醒归到哪一类统计；不统计的返回 null。 */
export function alertOutcomeKind(entry) {
  const key = String(record(entry).dedupe_key || '');
  if (/^qqq-drawdown(-live|-confirm)?:/.test(key)) return 'qqq_drawdown';
  if (/^vix-(rise|level):/.test(key)) return 'vix_spike';
  if (/^cnn-(tier|deeper):/.test(key)) return 'cnn_fear';
  if (key.startsWith('z-cross:')) {
    const tier = Math.abs(Number(key.split(':')[2]));
    if (!Number.isFinite(tier)) return null;
    if (tier >= 1.5) return 'z_enter';
    return tier === 1 ? 'z_cross_1' : null;
  }
  if (key.startsWith('big-move:')) return 'big_move';
  if (key.startsWith('sell-line-live:') || /^state:sell:/.test(key)) return 'sell_line';
  if (key.startsWith('resonance:')) return 'resonance';
  if (/^push:[^:]+:[^:]+:(valuation|buy):/.test(key)) return 'valuation_buy';
  return null;
}

/** 看之后谁的走势：CNN、VIX 这种不可交易的看 QQQ。 */
export function outcomeSymbol(entry) {
  const symbol = String(record(entry).symbol || '').toUpperCase();
  if (!symbol || symbol === 'CNN' || symbol === 'VIX') return 'QQQ';
  return symbol;
}

function changesFrom(series, baseDate) {
  const points = (Array.isArray(series) ? series : [])
    .filter((point) => typeof point?.date === 'string' && finite(point.close) !== null && point.close > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  const start = points.findIndex((point) => point.date >= baseDate);
  if (start < 0) return null;
  const base = points[start].close;
  const changes = {};
  for (const days of OUTCOME_HORIZONS) {
    const target = points[start + days];
    changes[`d${days}`] = target ? (target.close / base - 1) * 100 : null;
  }
  return { baseDate: points[start].date, base, changes };
}

function difference(left, right) {
  const result = {};
  for (const days of OUTCOME_HORIZONS) {
    const a = left?.[`d${days}`];
    const b = right?.[`d${days}`];
    result[`d${days}`] = a === null || a === undefined || b === null || b === undefined ? null : a - b;
  }
  return result;
}

/**
 * 算出每条提醒之后的涨跌。seriesFor(symbol) 给完整收盘序列；
 * 拿不到行情、已作废、不在统计范围内的一律跳过，不编数字。
 */
export function computeAlertOutcomes(store, { seriesFor }) {
  const outcomes = {};
  const cache = new Map();
  const series = (symbol) => {
    if (!cache.has(symbol)) cache.set(symbol, seriesFor(symbol) || []);
    return cache.get(symbol);
  };
  for (const raw of record(store).alerts || []) {
    const entry = record(raw);
    if (entry.voided === true) continue;
    const kind = alertOutcomeKind(entry);
    if (!kind) continue;
    const occurredAt = new Date(String(entry.occurred_at || ''));
    if (Number.isNaN(+occurredAt)) continue;
    const symbol = outcomeSymbol(entry);
    const own = changesFrom(series(symbol), etParts(occurredAt).date);
    if (!own) continue;
    const benchmark = symbol === 'QQQ' ? own : changesFrom(series('QQQ'), own.baseDate);
    outcomes[String(entry.id)] = {
      kind,
      symbol,
      // 状态类提醒的「同一件事」标识：统计时同一个 run_key 连续多天只算第一次
      run_key: runKeyOf(entry, kind),
      base_date: own.baseDate,
      base_close: own.base,
      backfilled: entry.backfilled === true,
      pending: OUTCOME_HORIZONS.some((days) => own.changes[`d${days}`] === null),
      changes: own.changes,
      benchmark: benchmark ? benchmark.changes : { d1: null, d5: null, d20: null },
      excess: difference(own.changes, benchmark ? benchmark.changes : null),
    };
  }
  return outcomes;
}

/** 状态类提醒（可买 / 低估值）的「同一件事」标识，取事件键里的 kind:标的:档位。 */
function runKeyOf(entry, kind) {
  if (kind !== 'valuation_buy') return null;
  const parts = String(record(entry).dedupe_key || '').split(':');
  const start = parts.findIndex((part) => part === 'valuation' || part === 'buy');
  if (start < 0) return null;
  const take = parts[start] === 'valuation' ? 3 : 2;
  return parts.slice(start, start + take).join(':');
}

/** 同一个 run_key 连续多天只保留第一条；隔得够久再出现算新的一次。 */
function withoutConsecutiveRuns(items) {
  const byRun = new Map();
  for (const item of items) {
    const key = item.run_key;
    if (!key) continue;
    if (!byRun.has(key)) byRun.set(key, []);
    byRun.get(key).push(item);
  }
  const dropped = new Set();
  for (const group of byRun.values()) {
    const sorted = [...group].sort((left, right) => String(left.base_date).localeCompare(String(right.base_date)));
    let previous = null;
    for (const item of sorted) {
      const days = previous === null
        ? Infinity
        : (Date.parse(`${item.base_date}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`)) / 86_400_000;
      if (Number.isFinite(days) && days <= VALUATION_RUN_GAP_DAYS) dropped.add(item);
      else previous = item.base_date;
    }
  }
  return items.filter((item) => !dropped.has(item));
}

function average(values) {
  const usable = values.filter((value) => finite(value) !== null);
  if (usable.length === 0) return null;
  return usable.reduce((total, value) => total + value, 0) / usable.length;
}

/** 按类型汇总：次数、5/20 天平均涨跌、胜率、相对 QQQ 的超额收益。 */
export function summarizeOutcomes(outcomes) {
  const groups = new Map();
  for (const outcome of Object.values(record(outcomes))) {
    const kind = String(outcome?.kind || '');
    if (!OUTCOME_KINDS.includes(kind)) continue;
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push(outcome);
  }
  return OUTCOME_KINDS.filter((kind) => groups.has(kind)).map((kind) => {
    const items = withoutConsecutiveRuns(groups.get(kind));
    const settled = items.filter((item) => finite(item.changes?.d20) !== null);
    const samples = items.length;
    // 这几类看的就是 QQQ 自己，「对 QQQ 超额」恒等于 0，没有意义，留空让页面显示「—」
    const selfBenchmark = items.every((item) => String(item.symbol || '').toUpperCase() === 'QQQ');
    return {
      kind,
      label: OUTCOME_KIND_LABELS[kind],
      samples,
      pending: items.filter((item) => item.pending === true).length,
      backfilled: items.filter((item) => item.backfilled === true).length,
      avg: {
        d5: average(items.map((item) => item.changes?.d5)),
        d20: average(items.map((item) => item.changes?.d20)),
      },
      excess: {
        d5: selfBenchmark ? null : average(items.map((item) => item.excess?.d5)),
        d20: selfBenchmark ? null : average(items.map((item) => item.excess?.d20)),
      },
      selfBenchmark,
      winRate: settled.length === 0 ? null : settled.filter((item) => item.changes.d20 > 0).length / settled.length,
      reliable: samples >= MIN_RELIABLE_SAMPLES,
      note: samples >= MIN_RELIABLE_SAMPLES ? '' : UNRELIABLE_NOTE,
    };
  });
}

export function emptyAlertOutcomes() {
  return { version: ALERT_OUTCOMES_VERSION, updated_at: null, outcomes: {}, summary: [] };
}

export async function readAlertOutcomes(root) {
  try {
    const value = JSON.parse(await readFile(join(root, ALERT_OUTCOMES_FILE), 'utf8'));
    return {
      version: ALERT_OUTCOMES_VERSION,
      updated_at: typeof value?.updated_at === 'string' ? value.updated_at : null,
      outcomes: record(value?.outcomes),
      summary: Array.isArray(value?.summary) ? value.summary : [],
    };
  } catch {
    return emptyAlertOutcomes();
  }
}

export async function writeAlertOutcomes(root, store) {
  await mkdir(root, { recursive: true });
  const target = join(root, ALERT_OUTCOMES_FILE);
  const temporary = join(root, `.${ALERT_OUTCOMES_FILE}-${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** 提醒效果只读。 */
export function createAlertOutcomesRoute({ root, sendJson }) {
  return async function handleAlertOutcomesRoute(url, req, res) {
    if (url.pathname !== '/api/portfolio/alert-outcomes') return false;
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: { code: 'method_not_allowed', message: '提醒效果只读' } });
      return true;
    }
    sendJson(res, 200, { outcomes: await readAlertOutcomes(root) });
    return true;
  };
}
