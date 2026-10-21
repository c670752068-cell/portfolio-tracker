import { etParts } from './market-session.mjs';
import { normalizeAlertLog } from './alert-log.mjs';

// 修旧账：非常规时段（盘前 / 盘后 / 夜盘）的「较昨收」用错了参考价——
// Yahoo 的 chartPreviousClose 在这些时段指向「上一个交易日的再前一天」。
// 这里按真实日线收盘价重算：实际没到阈值的标作废，仍超过阈值的改正数字并标「已更正」。
// 只加标记、只改数字，原文一律保留在 corrected_from 里，一行都不删。
export const REFERENCE_FIX_REASON = '参考价错误';
export const Z_CACHE_FIX_REASON = '盘前/盘后 Z 用了隔夜缓存，重放了上一个交易日的穿越';
// 当时在用的阈值：个股 ±5%，QQQ ±2%。按当时的规则判断这条提醒该不该发。
const BIG_MOVE_LIMIT = 5;
const QQQ_BIG_MOVE_LIMIT = 2;
const REGULAR_CLOSE_MINUTES = 16 * 60;
const PRICE_IN_TEXT = /·\s*([\d.]+)\s*·/u;

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function finite(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * 最近一个已完成常规交易日的收盘价。
 * 当天 16:00 ET 之后（盘后）用当天的收盘价，之前（盘前、夜盘）用上一个交易日的。
 */
export function referenceClose(series, occurredAt) {
  const at = new Date(String(occurredAt || ''));
  if (Number.isNaN(+at)) return null;
  const clock = etParts(at);
  const closed = clock.minutes >= REGULAR_CLOSE_MINUTES;
  const points = (Array.isArray(series) ? series : [])
    .filter((point) => typeof point?.date === 'string' && finite(point.close) !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
  const usable = points.filter((point) => (closed ? point.date <= clock.date : point.date < clock.date));
  return usable.length ? usable.at(-1).close : null;
}

function limitFor(symbol) {
  return String(symbol || '').toUpperCase() === 'QQQ' ? QQQ_BIG_MOVE_LIMIT : BIG_MOVE_LIMIT;
}

/** 按真实收盘价重算，给出每条该怎么处理。 */
export function planReferencePriceFixes(store, { seriesFor }) {
  const plans = [];
  for (const raw of record(store).alerts || []) {
    const entry = record(raw);
    if (entry.voided === true || entry.corrected === true) continue;
    if (entry.session === 'regular' || !entry.session) continue;
    const key = String(entry.dedupe_key || '');

    if (key.startsWith('z-cross:')) {
      plans.push({ id: String(entry.id), action: 'void', reason: Z_CACHE_FIX_REASON });
      continue;
    }
    if (!key.startsWith('big-move:')) continue;

    const price = finite(PRICE_IN_TEXT.exec(String(entry.text || ''))?.[1]);
    const reference = referenceClose(seriesFor(String(entry.symbol || '')), entry.occurred_at);
    if (price === null || reference === null || reference <= 0) continue;

    const actualPct = (price / reference - 1) * 100;
    if (Math.abs(actualPct) < limitFor(entry.symbol)) {
      plans.push({ id: String(entry.id), action: 'void', reason: REFERENCE_FIX_REASON, actualPct });
      continue;
    }
    const rounded = `${actualPct > 0 ? '+' : ''}${actualPct.toFixed(1)}%`;
    const text = String(entry.text || '')
      .replace(/[+-][\d.]+%/u, rounded)
      .replace(/大(涨|跌)/u, actualPct > 0 ? '大涨' : '大跌');
    plans.push({ id: String(entry.id), action: 'correct', actualPct, text, reason: REFERENCE_FIX_REASON });
  }
  return plans;
}

/** 把结论写回日志：作废只加标记，更正保留原文。 */
export function applyReferencePriceFixes(store, { seriesFor, now = new Date() } = {}) {
  const current = normalizeAlertLog(store);
  const plans = new Map(planReferencePriceFixes(current, { seriesFor }).map((plan) => [plan.id, plan]));
  if (plans.size === 0) return store;
  const alerts = current.alerts.map((item) => {
    const plan = plans.get(String(item.id));
    if (!plan) return item;
    if (plan.action === 'void') {
      return { ...item, voided: true, voided_reason: plan.reason, voided_at: now.toISOString() };
    }
    return {
      ...item,
      text: plan.text,
      value: plan.actualPct,
      corrected: true,
      corrected_reason: plan.reason,
      corrected_at: now.toISOString(),
      corrected_from: item.text,
    };
  });
  return { ...current, alerts, updated_at: now.toISOString() };
}
