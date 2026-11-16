// 日志页的恐慌指数（VXSMH / VXN / VIX）：报价条和一年日线。
// 现价走 Yahoo，日线走 Cboe 官网公开的历史数据（Yahoo 上 ^VXSMH 没有历史）。
// 不用 TradingView 嵌入组件：实测 CBOE:VXSMH 只显示「此商品代码仅在 TradingView 上可用」。
import { etParts } from './market-session.mjs';

// underlying：恐慌指数对应的 ETF。价格优先：恐慌指数到线只是「波动大」，
// 还要这只 ETF 跌破 200 日均线 −1.5σ 通道下沿，才算真的便宜、才是买点。
export const VOLATILITY_ITEMS = [
  { key: 'VXSMH', name: '半导体', symbol: '^VXSMH', cboe: '_VXSMH', underlying: 'SMH' },
  { key: 'VXN', name: '纳指', symbol: '^VXN', cboe: '_VXN', underlying: 'QQQ' },
  { key: 'VIX', name: '标普', symbol: '^VIX', cboe: '_VIX', underlying: 'SPY' },
];
export const VOLATILITY_QUOTE_TTL_MS = 60_000;
export const VOLATILITY_HISTORY_TTL_MS = 6 * 3_600_000;
const HISTORY_WINDOW_MS = 365 * 86_400_000;

function finite(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function cboeHistoryUrl(item) {
  return `https://cdn-api.cboe.com/api/global/delayed_quotes/charts/historical/${item.cboe}.json`;
}

/** Cboe 的 _VIX 有三十多年、上万行：解析完只留最近一年，不把整份留在内存里。 */
export function parseCboeHistory(body, now = new Date()) {
  const rows = Array.isArray(body?.data) ? body.data : [];
  const since = new Date(+now - HISTORY_WINDOW_MS).toISOString().slice(0, 10);
  return rows.flatMap((row) => {
    const date = typeof row?.date === 'string' ? row.date : '';
    const close = finite(row?.close);
    return date >= since && date !== '' && close !== null && close > 0 ? [{ date, close }] : [];
  });
}

/** 现价比日线新一天就补在末尾，盘中图不会比上面的数字少一天。日期按美东算。 */
export function withLatestPoint(series, quote) {
  const price = finite(quote?.price);
  if (price === null || !quote?.quoteTime) return series;
  const date = etParts(new Date(quote.quoteTime)).date;
  const last = series[series.length - 1]?.date ?? '';
  return date > last ? [...series, { date, close: price }] : series;
}

/**
 * 趋势图（ma-slope 仪表盘）的日线 → 每天的收盘价、通道下沿、Z。
 * 下沿就是 band200 的第一个数（200 日均线 − 1.5σ），和「股价与移动均线 + ±1.5σ 通道」同一条线。
 */
export function channelFromDashboard(dashboard) {
  const series = dashboard?.dashboard?.series;
  if (!Array.isArray(series)) return [];
  return series.flatMap((point) => {
    const date = typeof point?.date === 'string' ? point.date : '';
    const close = finite(point?.close);
    const z = finite(point?.zscore200);
    const lower = Array.isArray(point?.band200) ? finite(point.band200[0]) : null;
    return date !== '' && close !== null && z !== null
      ? [{ date, close, lower, z, partial: point?.is_partial === true }]
      : [];
  });
}

function underlyingSummary(symbol, channel) {
  const latest = channel.at(-1);
  if (!latest) return { symbol, as_of: null, close: null, lower_band: null, z_score: null, partial: false };
  return {
    symbol,
    as_of: latest.date,
    close: latest.close,
    lower_band: latest.lower,
    z_score: latest.z,
    partial: latest.partial,
  };
}

/** 每个恐慌指数的日线点挂上同一天 ETF 的 Z，网页据此区分「真买点」和「只是波动大」。 */
function withUnderlyingZ(series, channel) {
  if (channel.length === 0) return series;
  const byDate = new Map(channel.map((point) => [point.date, point.z]));
  return series.map((point) => (byDate.has(point.date) ? { ...point, z: byDate.get(point.date) } : point));
}

export function buildVolatilityPayload({ quotes = {}, history = {}, channels = {}, now = new Date() }) {
  return {
    version: 2,
    time: now.toISOString(),
    items: VOLATILITY_ITEMS.map(({ key, name, symbol, underlying }) => {
      const channel = Array.isArray(channels[key]) ? channels[key] : [];
      const quote = quotes[key] ?? null;
      const price = finite(quote?.price);
      const previousClose = finite(quote?.previousClose);
      return {
        key,
        name,
        symbol,
        price,
        change_percent: price === null || previousClose === null || previousClose <= 0
          ? null
          : (price / previousClose - 1) * 100,
        quote_time: typeof quote?.quoteTime === 'string' ? quote.quoteTime : null,
        series: withUnderlyingZ(withLatestPoint(history[key] ?? [], quote), channel),
        underlying: underlyingSummary(underlying, channel),
      };
    }),
  };
}

/**
 * 现价 60 秒取一次，日线 6 小时取一次。单个标的失败不影响另外两个，沿用上一次成功的数；
 * 日线失败不记时间，下一轮就重试。同时来的请求共用一次取数。
 */
export function createVolatilityCache({ fetchQuote, fetchHistory, fetchChannel = null, now = () => new Date() }) {
  const quotes = {};
  const history = {};
  const channels = {};
  const historyAt = {};
  let cached = null;
  let inflight = null;

  const refresh = async (at) => {
    await Promise.all(VOLATILITY_ITEMS.map(async (item) => {
      const needsHistory = historyAt[item.key] === undefined || +at - historyAt[item.key] >= VOLATILITY_HISTORY_TTL_MS;
      // 通道数据由趋势图那套缓存自己管有效期（5 分钟），这里每轮都问一次；失败沿用上一次的。
      const [quote, series, channel] = await Promise.all([
        fetchQuote(item.symbol).catch(() => null),
        needsHistory ? fetchHistory(item).catch(() => null) : null,
        fetchChannel ? Promise.resolve().then(() => fetchChannel(item.underlying)).catch(() => null) : null,
      ]);
      if (quote) quotes[item.key] = quote;
      if (Array.isArray(channel) && channel.length > 0) channels[item.key] = channel;
      if (series) {
        history[item.key] = series;
        historyAt[item.key] = +at;
      }
    }));
    cached = { at, payload: buildVolatilityPayload({ quotes, history, channels, now: at }) };
    return cached.payload;
  };

  return {
    async read() {
      const at = now();
      if (cached && +at - +cached.at < VOLATILITY_QUOTE_TTL_MS) return cached.payload;
      inflight ??= refresh(at).finally(() => { inflight = null; });
      return inflight;
    },
  };
}

export function createVolatilityRoute({ cache, sendJson }) {
  return async function handleVolatilityRoute(url, req, res) {
    if (url.pathname !== '/api/portfolio/volatility') return false;
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: { code: 'method_not_allowed', message: '恐慌指数只读' } });
      return true;
    }
    sendJson(res, 200, { volatility: await cache.read() });
    return true;
  };
}
