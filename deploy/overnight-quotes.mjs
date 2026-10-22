// 夜盘（美东 20:00–04:00）美股报价：免费源在这个时段是停的，富途 OpenD 有。
// OpenD 只在 Mac 本机监听，所以由 Mac 上的 sync/push-overnight-quotes.mjs 定时
// 推到这里，网关存在内存里给实时监控和网页用。推送断了就按「夜盘无报价」处理，
// 绝不沿用盘后最后一笔。
export const OVERNIGHT_QUOTE_TTL_MS = 15 * 60 * 1000;

function finite(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** 把推上来的报价规整成 { 标的: 报价 }；形状不对的直接丢。 */
export function normalizeOvernightUpload(body) {
  // 网关的读体函数给的是 Buffer，先转成对象
  let parsed = body;
  if (Buffer.isBuffer(body) || typeof body === 'string') {
    try {
      parsed = JSON.parse(String(body));
    } catch {
      return {};
    }
  }
  const value = typeof parsed === 'object' && parsed !== null ? parsed : {};
  const rows = Array.isArray(value.quotes) ? value.quotes : [];
  const source = typeof value.source === 'string' && value.source ? value.source : 'futu_opend';
  const quotes = {};
  for (const raw of rows) {
    const item = typeof raw === 'object' && raw !== null ? raw : {};
    const symbol = String(item.symbol || '').trim().toUpperCase().replace(/^US\./, '');
    const price = finite(item.price);
    const priceTime = typeof item.priceTime === 'string' && !Number.isNaN(Date.parse(item.priceTime))
      ? new Date(item.priceTime).toISOString()
      : null;
    if (!symbol || price === null || price <= 0 || priceTime === null) continue;
    quotes[symbol] = {
      symbol,
      price,
      previousClose: finite(item.previousClose),
      priceTime,
      source,
    };
  }
  return quotes;
}

export function createOvernightQuoteStore({ ttlMs = OVERNIGHT_QUOTE_TTL_MS } = {}) {
  let quotes = {};
  let updatedAt = null;
  return {
    put(next, at = new Date()) {
      const pushedAt = +at;
      quotes = { ...quotes, ...Object.fromEntries(
        Object.entries(next).map(([symbol, quote]) => [symbol, { ...quote, pushedAt }]),
      ) };
      updatedAt = pushedAt;
    },
    // 判活看「什么时候推上来的」：夜盘成交稀疏，十几分钟没有新成交很正常，
    // 价格本身有多旧交给 pickOvernightQuote 去标。
    get(symbol, now = new Date()) {
      const quote = quotes[String(symbol || '').toUpperCase()];
      if (!quote) return null;
      const age = +now - Number(quote.pushedAt);
      return Number.isFinite(age) && age <= ttlMs ? quote : null;
    },
    updatedAt() {
      return updatedAt;
    },
    size() {
      return Object.keys(quotes).length;
    },
  };
}

/** 接收 Mac 推上来的夜盘报价；和持仓上传用同一个令牌。 */
export function createOvernightQuotesRoute({ store, token, sendJson, readBody }) {
  return async function handleOvernightQuotesRoute(url, req, res) {
    if (url.pathname !== '/api/portfolio/overnight-quotes') return false;
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: { code: 'method_not_allowed', message: '夜盘报价只接收上传' } });
      return true;
    }
    if (!token || req.headers.authorization !== `Bearer ${token}`) {
      sendJson(res, 401, { error: { code: 'unauthorized', message: '认证失败' } });
      return true;
    }
    try {
      const quotes = normalizeOvernightUpload(await readBody(req));
      store.put(quotes);
      sendJson(res, 200, { accepted: Object.keys(quotes).length });
    } catch (error) {
      sendJson(res, 400, {
        error: { code: 'request_body_error', message: error instanceof Error ? error.message : '上传内容无法解析' },
      });
    }
    return true;
  };
}
