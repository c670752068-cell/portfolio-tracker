// 三大指数卡片的数据：常规交易时段看指数本身，盘前/盘后/夜盘/休市看对应期货。
// 服务器统一取数并缓存，打开网页的设备再多，上游也只按刷新间隔取一次。
// 数据源：Yahoo Finance（免费）。实测指数基本无延迟，CME 期货约 10 分钟延迟，
// 实际延迟按行情时间算出来照实显示，不写死。
export const INDEX_ITEMS = [
  { key: 'nasdaq', name: '纳斯达克', symbol: '^IXIC', futuresName: '纳指期货', futuresSymbol: 'NQ=F' },
  { key: 'sp500', name: '标普500', symbol: '^GSPC', futuresName: '标普期货', futuresSymbol: 'ES=F' },
  { key: 'dow', name: '道琼斯', symbol: '^DJI', futuresName: '道指期货', futuresSymbol: 'YM=F' },
];
export const INDEX_REFRESH_REGULAR_MS = 10_000;
export const INDEX_REFRESH_OTHER_MS = 30_000;

function finite(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * 从 Yahoo 的 chart 返回里取报价。涨跌幅一律对 chartPreviousClose 算
 * （指数是昨收，期货是上一个结算价）——不能用 regularMarketPrice 当参考，
 * 那是现价本身，期货会算成 0%。
 */
export function parseIndexQuote(data) {
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) return null;
  const price = finite(meta.regularMarketPrice);
  if (price === null) return null;
  const seconds = finite(meta.regularMarketTime);
  return {
    price,
    previousClose: finite(meta.chartPreviousClose),
    quoteTime: seconds === null ? null : new Date(seconds * 1000).toISOString(),
  };
}

export function indexRefreshMs(session) {
  return session === 'regular' ? INDEX_REFRESH_REGULAR_MS : INDEX_REFRESH_OTHER_MS;
}

/** 这个时段该看哪三个标的。 */
export function indexSymbolsFor(session) {
  const futures = session !== 'regular';
  return INDEX_ITEMS.map((item) => ({
    key: item.key,
    name: futures ? item.futuresName : item.name,
    symbol: futures ? item.futuresSymbol : item.symbol,
    futures,
  }));
}

export function buildIndexPayload({ session, quotes = {}, now = new Date() }) {
  const items = indexSymbolsFor(session).map((item) => {
    const quote = quotes[item.symbol] || {};
    const price = finite(quote.price);
    const previousClose = finite(quote.previousClose);
    const quoteTime = typeof quote.quoteTime === 'string' && !Number.isNaN(Date.parse(quote.quoteTime))
      ? quote.quoteTime
      : null;
    return {
      ...item,
      price,
      change_percent: price === null || previousClose === null || previousClose <= 0
        ? null
        : (price / previousClose - 1) * 100,
      quote_time: quoteTime,
      // 行情本身的延迟（分钟），按行情时间算，拿不到就留空
      delay_minutes: quoteTime === null ? null : Math.max(0, Math.round((+now - Date.parse(quoteTime)) / 60_000)),
    };
  });
  return {
    version: 1,
    session,
    time: now.toISOString(),
    refresh_ms: indexRefreshMs(session),
    source: 'Yahoo Finance',
    items,
  };
}

/**
 * 服务器侧缓存：同一时段在刷新间隔内只取一次；换了时段（指数↔期货）立刻重取。
 * 单个标的取数失败只让那一行留空，不影响另外两行。
 */
export function createIndexQuotesCache({ fetchQuote, now = () => new Date() }) {
  let cached = null;
  return {
    async read(session) {
      const at = now();
      if (cached && cached.session === session && +at - +cached.at < indexRefreshMs(session)) {
        return cached.payload;
      }
      const quotes = {};
      await Promise.all(indexSymbolsFor(session).map(async (item) => {
        try {
          const quote = await fetchQuote(item.symbol);
          if (quote) quotes[item.symbol] = quote;
        } catch {
          // 这一行留空，另外两行照常
        }
      }));
      const payload = buildIndexPayload({ session, quotes, now: at });
      cached = { session, at, payload };
      return payload;
    },
  };
}

/** 三大指数只读。 */
export function createIndexQuotesRoute({ cache, sessionOf, sendJson }) {
  return async function handleIndexQuotesRoute(url, req, res) {
    if (url.pathname !== '/api/portfolio/index-quotes') return false;
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: { code: 'method_not_allowed', message: '三大指数只读' } });
      return true;
    }
    sendJson(res, 200, { indexes: await cache.read(sessionOf()) });
    return true;
  };
}
