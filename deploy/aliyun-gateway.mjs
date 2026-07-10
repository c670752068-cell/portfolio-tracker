/**
 * Private portfolio gateway for the Aliyun deployment.
 *
 * It intentionally does not store any AI API key. The browser sends its own
 * Key in the Authorization header, and the gateway serialises requests per
 * hashed key before forwarding them to the selected provider. This prevents
 * accidental parallel "test connection" + "parse screenshot" requests from
 * causing account-level rate-limit errors.
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { get as httpsGet } from 'node:https';
import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const PORT = Number(process.env.PORT || 8789);
const HOST = process.env.HOST || '127.0.0.1';
const STATIC_ROOT = process.env.STATIC_ROOT ? resolve(process.env.STATIC_ROOT) : '';
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 180_000;
const requestQueues = new Map();

const AI_ROUTES = {
  '/api/zhipu/chat/completions': 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  '/api/kimi/chat/completions': 'https://api.moonshot.cn/v1/chat/completions',
};

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  let total = 0;
  const parts = [];
  for await (const part of req) {
    total += part.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error('请求体超过 20MB 限制');
      error.status = 413;
      throw error;
    }
    parts.push(part);
  }
  return Buffer.concat(parts);
}

async function runSerially(key, task) {
  const previous = requestQueues.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  requestQueues.set(key, current);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (requestQueues.get(key) === current) requestQueues.delete(key);
  }
}

function apiKeyHash(authorization) {
  return createHash('sha256').update(authorization).digest('hex');
}

async function proxyAi(req, res, upstream) {
  const authorization = req.headers.authorization || '';
  if (!/^Bearer\s+\S+/i.test(authorization)) {
    sendJson(res, 401, { error: { code: 'missing_api_key', message: '请在网页设置中填写 API Key。' } });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, error.status || 400, { error: { code: 'request_body_error', message: error.message } });
    return;
  }

  try {
    const upstreamResponse = await runSerially(apiKeyHash(authorization), async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
      try {
        return await fetch(upstream, {
          method: 'POST',
          headers: {
            Authorization: authorization,
            'Content-Type': req.headers['content-type'] || 'application/json',
            Accept: 'application/json',
          },
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    });
    const payload = await upstreamResponse.arrayBuffer();
    const contentType = upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8';
    res.writeHead(upstreamResponse.status, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Portfolio-Gateway': 'aliyun',
    });
    res.end(Buffer.from(payload));
  } catch (error) {
    const timeout = error?.name === 'AbortError';
    sendJson(res, timeout ? 504 : 502, {
      error: {
        code: timeout ? 'upstream_timeout' : 'gateway_error',
        message: timeout ? '上游 AI 服务超过 180 秒未返回' : `服务器转发失败：${error instanceof Error ? error.message : String(error)}`,
      },
    });
  }
}

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/[$,%\s,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function lastNumber(values) {
  if (!Array.isArray(values)) return null;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = asNumber(values[index]);
    if (value != null) return value;
  }
  return null;
}

function lastTimestamp(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const value = Number(values.at(-1));
  return Number.isFinite(value) ? new Date(value * 1000).toISOString() : null;
}

function getJsonOverIpv4(url, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = httpsGet(url, { headers, family: 4, timeout: timeoutMs }, (response) => {
      const parts = [];
      response.on('data', (part) => parts.push(part));
      response.on('error', reject);
      response.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        if ((response.statusCode || 500) < 200 || (response.statusCode || 500) >= 300) {
          reject(new Error(`HTTP ${response.statusCode || 500}: ${text.slice(0, 160)}`));
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error('上游返回了非 JSON 数据'));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error(`请求超过 ${Math.round(timeoutMs / 1000)} 秒`)));
    request.on('error', reject);
  });
}

async function fetchYahooQuote(symbol) {
  const yahooSymbol = symbol.replace('.', '-');
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=5d&interval=1d`;
  const data = await getJsonOverIpv4(url, { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }, 8_000);
  const result = data?.chart?.result?.[0];
  const meta = result?.meta || {};
  const price = asNumber(meta.regularMarketPrice) ?? lastNumber(result?.indicators?.quote?.[0]?.close);
  if (price == null) throw new Error('Yahoo 未返回有效价格');
  const previousClose = asNumber(meta.chartPreviousClose);
  const change = previousClose == null ? null : price - previousClose;
  return {
    symbol,
    price,
    previousClose,
    change,
    changePercent: previousClose ? change / previousClose : null,
    currency: meta.currency || 'USD',
    timestamp: meta.regularMarketTime ? new Date(Number(meta.regularMarketTime) * 1000).toISOString() : lastTimestamp(result?.timestamp),
    source: 'proxy',
    isRealtime: false,
  };
}

async function fetchNasdaqQuote(symbol) {
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=stocks`;
  const data = await getJsonOverIpv4(url, {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0',
      'Accept-Language': 'en-US,en;q=0.9',
    }, 12_000);
  const primary = data?.data?.primaryData;
  const price = asNumber(primary?.lastSalePrice);
  if (price == null) throw new Error('NASDAQ 未返回有效价格');
  const change = asNumber(primary?.netChange);
  const changePercent = asNumber(primary?.percentageChange);
  return {
    symbol,
    price,
    previousClose: change == null ? null : price - change,
    change,
    changePercent: changePercent == null ? null : changePercent / 100,
    currency: 'USD',
    timestamp: primary?.lastTradeTimestamp || null,
    source: 'proxy',
    isRealtime: Boolean(primary?.isRealTime),
  };
}

async function fetchFreeQuote(symbol) {
  try {
    return await fetchYahooQuote(symbol);
  } catch (yahooError) {
    try {
      return await fetchNasdaqQuote(symbol);
    } catch (nasdaqError) {
      const yahooReason = yahooError instanceof Error ? yahooError.message : String(yahooError);
      const nasdaqReason = nasdaqError instanceof Error ? nasdaqError.message : String(nasdaqError);
      throw new Error(`Yahoo: ${yahooReason}; NASDAQ: ${nasdaqReason}`);
    }
  }
}

async function proxyQuotes(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const symbols = [...new Set((url.searchParams.get('symbols') || '').split(',').map((value) => value.trim().toUpperCase()).filter(Boolean))].slice(0, 50);
  const rows = await Promise.all(symbols.map(async (symbol) => {
    try {
      return { symbol, quote: await fetchFreeQuote(symbol) };
    } catch (error) {
      return { symbol, reason: error instanceof Error ? error.message : String(error) };
    }
  }));
  sendJson(res, 200, {
    quotes: rows.filter((row) => row.quote).map((row) => row.quote),
    failedSymbols: rows.filter((row) => !row.quote).map((row) => ({ symbol: row.symbol, reason: row.reason })),
  });
}

async function serveStatic(url, req, res) {
  if (!STATIC_ROOT) return false;
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendJson(res, 400, { error: { code: 'bad_path', message: '路径不合法' } });
    return true;
  }
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let filePath = normalize(join(STATIC_ROOT, relativePath));
  if (!filePath.startsWith(`${STATIC_ROOT}/`) && filePath !== STATIC_ROOT) {
    sendJson(res, 403, { error: { code: 'forbidden', message: '禁止访问' } });
    return true;
  }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // Vite single-page routes should return the application entry point.
    filePath = join(STATIC_ROOT, 'index.html');
  }
  try {
    await access(filePath);
  } catch {
    sendJson(res, 404, { error: { code: 'not_found', message: '文件不存在' } });
    return true;
  }
  const extension = extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
    'Cache-Control': extension === '.html' || extension === '.js' && filePath.endsWith('runtime-config.js') ? 'no-cache' : 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
  } else {
    createReadStream(filePath).pipe(res);
  }
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, service: 'portfolio-ai-gateway', time: new Date().toISOString() });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/quotes') {
    await proxyQuotes(req, res);
    return;
  }
  const upstream = AI_ROUTES[url.pathname];
  if (req.method === 'POST' && upstream) {
    await proxyAi(req, res, upstream);
    return;
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && await serveStatic(url, req, res)) return;
  sendJson(res, 404, { error: { code: 'not_found', message: '未知接口' } });
});

server.listen(PORT, HOST, () => {
  console.log(`portfolio-ai-gateway listening on ${HOST}:${PORT}${STATIC_ROOT ? `; static=${STATIC_ROOT}` : ''}`);
});
