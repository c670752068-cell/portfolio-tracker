// 恐慌性下跌：标普 500 完整收盘跌 3% 以上，且道指、纳指同一天也收跌。
// 恐慌之后「窗口」打开（仓位才可以超过 30%），标普收盘收复跌前收盘（反弹回来了）就关。
// 数据源 Yahoo 日线，只看完整收盘，盘中那根不算。
import { etParts } from './market-session.mjs';

export const PANIC_SP500_DROP_PCT = -3;
export const PANIC_CACHE_TTL_MS = 30 * 60_000;
export const PANIC_INDEXES = [
  { key: 'sp500', symbol: '^GSPC' },
  { key: 'dow', symbol: '^DJI' },
  { key: 'nasdaq', symbol: '^IXIC' },
];
const RECENT_DAYS = 30;
const CLOSE_SETTLED_MINUTES = 16 * 60 + 15;

export function panicDailyUrl(symbol) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d`;
}

/** 只留完整收盘：今天要到美东 16:15 指数收盘价定下来才算。 */
export function parseDailyCloses(body, now = new Date()) {
  const result = body?.chart?.result?.[0];
  const stamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes)) return [];
  const today = etParts(now);
  return stamps.flatMap((stamp, index) => {
    const close = closes[index];
    if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) return [];
    const date = etParts(new Date(stamp * 1000)).date;
    const partial = date > today.date || (date === today.date && today.minutes < CLOSE_SETTLED_MINUTES);
    return partial ? [] : [{ date, close }];
  });
}

/** 三个指数都有数据的交易日，逐日算收盘涨跌幅并判定恐慌。 */
export function buildPanicDays({ sp500 = [], dow = [], nasdaq = [] }) {
  const dowCloses = new Map(dow.map((row) => [row.date, row.close]));
  const nasdaqCloses = new Map(nasdaq.map((row) => [row.date, row.close]));
  const rows = sp500.filter((row) => dowCloses.has(row.date) && nasdaqCloses.has(row.date));
  return rows.slice(1).map((row, index) => {
    const previous = rows[index];
    const sp500Pct = (row.close / previous.close - 1) * 100;
    const dowPct = (dowCloses.get(row.date) / dowCloses.get(previous.date) - 1) * 100;
    const nasdaqPct = (nasdaqCloses.get(row.date) / nasdaqCloses.get(previous.date) - 1) * 100;
    return {
      date: row.date,
      sp500: sp500Pct,
      dow: dowPct,
      nasdaq: nasdaqPct,
      sp500_close: row.close,
      previous_close: previous.close,
      // 去掉浮点误差，刚好 -3% 也算
      panic: Number(sp500Pct.toFixed(6)) <= PANIC_SP500_DROP_PCT && dowPct < 0 && nasdaqPct < 0,
    };
  });
}

/** 连续恐慌按第一次的跌前收盘算：要收复的是整轮下跌。 */
export function panicWindow(days) {
  let anchorClose = null;
  let lastPanic = null;
  let recoveredOn = null;
  for (const day of days) {
    if (anchorClose !== null && day.sp500_close >= anchorClose) {
      anchorClose = null;
      recoveredOn = day.date;
    }
    if (day.panic) {
      lastPanic = day;
      recoveredOn = null;
      anchorClose ??= day.previous_close;
    }
  }
  return { open: anchorClose !== null, anchorClose, lastPanic, recoveredOn };
}

const dayRow = ({ date, sp500, dow, nasdaq, panic }) => ({ date, sp500, dow, nasdaq, panic });

export function buildPanicPayload({ closes = {}, now = new Date() }) {
  const days = buildPanicDays(closes);
  const window = panicWindow(days);
  return {
    version: 1,
    time: now.toISOString(),
    as_of: days[days.length - 1]?.date ?? null,
    threshold_pct: PANIC_SP500_DROP_PCT,
    window_open: days.length > 0 ? window.open : null,
    anchor_close: window.anchorClose,
    recovered_on: window.recoveredOn,
    last_panic: window.lastPanic ? dayRow(window.lastPanic) : null,
    days: days.slice(-RECENT_DAYS).reverse().map(dayRow),
  };
}

/** 30 分钟取一次。某个指数失败就沿用它上一次的数，并且不记缓存，下次请求马上重取。 */
export function createPanicCache({ fetchCloses, now = () => new Date() }) {
  const closes = {};
  let cached = null;
  let inflight = null;

  const refresh = async (at) => {
    const results = await Promise.all(PANIC_INDEXES.map(async ({ key, symbol }) => {
      const rows = await fetchCloses(symbol).catch(() => []);
      if (rows.length > 0) closes[key] = rows;
      return rows.length > 0;
    }));
    const payload = buildPanicPayload({ closes, now: at });
    cached = results.every(Boolean) ? { at, payload } : null;
    return payload;
  };

  return {
    async read() {
      const at = now();
      if (cached && +at - +cached.at < PANIC_CACHE_TTL_MS) return cached.payload;
      inflight ??= refresh(at).finally(() => { inflight = null; });
      return inflight;
    },
  };
}

export function createPanicRoute({ cache, sendJson }) {
  return async function handlePanicRoute(url, req, res) {
    if (url.pathname !== '/api/portfolio/panic-drop') return false;
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: { code: 'method_not_allowed', message: '恐慌性下跌只读' } });
      return true;
    }
    sendJson(res, 200, { panic: await cache.read() });
    return true;
  };
}
