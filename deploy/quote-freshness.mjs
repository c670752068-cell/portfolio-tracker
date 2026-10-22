import { etParts } from './market-session.mjs';

// 行情新鲜度：交易时段里价格超过 15 分钟没更新，就不能再当成实时价格。
// 真实事故：夜盘（美东 20:00–04:00）Yahoo 的价格停在 19:59，网站却一直按
// isRealtime=true 显示，等于拿盘后最后一笔当夜盘价。
export const QUOTE_STALE_MS = 15 * 60 * 1000;
export const OVERNIGHT_NO_QUOTE_NOTE = '夜盘无报价';
// 这些时段价格本来就该一直在动
const LIVE_SESSIONS = new Set(['pre', 'regular', 'post', 'overnight']);

function finite(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ageMs(priceTime, now) {
  const at = Date.parse(String(priceTime || ''));
  return Number.isFinite(at) ? Math.max(0, +now - at) : null;
}

/** 价格停在哪一刻：用美东时间写，和提醒里的时间口径一致。 */
function stoppedAtNote(priceTime) {
  const at = new Date(String(priceTime || ''));
  if (Number.isNaN(+at)) return null;
  const clock = etParts(at);
  const hour = String(Math.floor(clock.minutes / 60)).padStart(2, '0');
  const minute = String(clock.minutes % 60).padStart(2, '0');
  return `数据停在 ${hour}:${minute}`;
}

/** 给报价打上新鲜度标记；不新鲜的 isRealtime 一律改成 false。 */
export function markQuoteFreshness(quote, { now = new Date(), session = 'closed' } = {}) {
  if (!quote) return quote;
  const age = ageMs(quote.priceTime, now);
  const live = LIVE_SESSIONS.has(session);
  const stale = live && (age === null || age > QUOTE_STALE_MS);
  return {
    ...quote,
    isRealtime: quote.isRealtime === true && !stale && age !== null,
    stale,
    price_age_minutes: age === null ? null : Math.round(age / 60_000),
    stale_note: stale ? stoppedAtNote(quote.priceTime) : null,
  };
}

/**
 * 夜盘用哪一份报价：
 * 1) 富途 OpenD 推上来的（有精确成交时刻）；
 * 2) 退到 Nasdaq 的最后成交价（有价格、没有成交时刻，照实标明）；
 * 3) 两个都没有就标「夜盘无报价」——不沿用盘后最后一笔。
 */
export function pickOvernightQuote({ pushed = null, nasdaq = null, yahoo = null, now = new Date() } = {}) {
  const tradeAge = pushed ? ageMs(pushed.priceTime, now) : null;
  if (pushed && finite(pushed.price) !== null && tradeAge !== null) {
    // 推送还活着就用它；成交时间太旧只标出来，不丢掉这个价
    const stale = tradeAge > QUOTE_STALE_MS;
    return {
      ...pushed,
      isRealtime: !stale,
      stale,
      price_time_known: true,
      price_age_minutes: Math.round(tradeAge / 60_000),
      stale_note: stale ? stoppedAtNote(pushed.priceTime) : null,
    };
  }
  if (nasdaq && finite(nasdaq.price) !== null) {
    return {
      ...nasdaq,
      // Nasdaq 的接口只给价格、不给成交时刻，所以不敢说是实时
      isRealtime: false,
      stale: false,
      price_time_known: false,
      price_age_minutes: null,
      stale_note: null,
    };
  }
  return {
    ...(yahoo || {}),
    price: null,
    isRealtime: false,
    stale: true,
    price_time_known: false,
    price_age_minutes: null,
    stale_note: OVERNIGHT_NO_QUOTE_NOTE,
  };
}

/**
 * 夜盘行情中断：交易时段里过半的标的都过期就记一条，恢复时记一条。
 * 走 applyStateAlerts 的状态翻转机制，同一次中断只写一次。
 */
export function feedOutageReading({ session, quotes = {}, now = new Date() } = {}) {
  void now;
  if (!LIVE_SESSIONS.has(session)) return null;
  const rows = Object.values(quotes).filter(Boolean);
  if (rows.length === 0) return null;
  const stale = rows.filter((quote) => quote.stale === true);
  const broken = stale.length > rows.length / 2;
  const stoppedAt = stale.find((quote) => quote.stale_note)?.stale_note || '';
  return {
    key: 'overnight-feed',
    state: broken ? 'triggered' : 'normal',
    category: 'system',
    symbol: null,
    icon: broken ? '❗' : '✅',
    value: stale.length,
    threshold: null,
    text: broken
      ? `夜盘行情中断 · ${stale.length}/${rows.length} 个标的${stoppedAt ? ` ${stoppedAt}` : ''} · 实时提醒暂停，恢复后会自动继续`
      : '夜盘行情已恢复',
  };
}
