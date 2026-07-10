// Cloudflare Worker：Moonshot Kimi API + Yahoo/NASDAQ 免费行情 CORS 代理
// 用途：
//   1. 浏览器无法直连 https://api.moonshot.cn 时，通过该 Worker 中转 Kimi。
//   2. GitHub Pages 前端无法直连行情 API 时，通过 /quotes?symbols=MSFT,IGV 获取免费行情。
// 部署步骤见 README.md「Kimi CORS 代理」和「行情同步」小节。
//
// 安全：
//   - 不在 Worker 里存 API Key，Key 由前端请求头 Authorization 透传。
//   - 建议在 Cloudflare 仪表板里给该 Worker 加自定义域名 + 速率限制。

const UPSTREAM = 'https://api.moonshot.cn';
const ALLOWED_ORIGINS = [
  // 本项目 GitHub Pages：
  'https://c670752068-cell.github.io',
  // 部署后把你的 GitHub Pages 地址加进来，比如：
  // 'https://your-name.github.io',
  // 本地开发：
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') ?? '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/quotes') {
      return jsonResponse(await fetchQuotes(url.searchParams.get('symbols') ?? ''), cors);
    }

    const upstream = UPSTREAM + url.pathname + url.search;

    const upstreamReq = new Request(upstream, {
      method: request.method,
      headers: {
        Authorization: request.headers.get('Authorization') ?? '',
        'Content-Type': request.headers.get('Content-Type') ?? 'application/json',
      },
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text(),
    });

    const resp = await fetch(upstreamReq);
    const out = new Response(resp.body, resp);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};

async function fetchQuotes(symbolsParam) {
  const symbols = uniqueSymbols(symbolsParam);
  const rows = await Promise.all(symbols.map(fetchFreeQuote));
  return {
    quotes: rows.filter((row) => row.ok).map((row) => row.quote),
    failedSymbols: rows.filter((row) => !row.ok).map((row) => ({ symbol: row.symbol, reason: row.reason })),
  };
}

async function fetchFreeQuote(symbol) {
  const yahoo = await fetchYahooQuote(symbol);
  if (yahoo.ok) return yahoo;
  const nasdaq = await fetchNasdaqQuote(symbol);
  if (nasdaq.ok) return nasdaq;
  return { ok: false, symbol, reason: `Yahoo: ${yahoo.reason}; NASDAQ: ${nasdaq.reason}` };
}

async function fetchYahooQuote(symbol) {
  try {
    const yahooSymbol = toYahooSymbol(symbol);
    const upstream = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=5d&interval=1d`;
    const resp = await fetch(upstream, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
    });
    if (!resp.ok) return { ok: false, symbol, reason: `Yahoo HTTP ${resp.status}` };
    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta ?? {};
    const price = parseNumber(meta.regularMarketPrice) ?? lastNumber(result?.indicators?.quote?.[0]?.close);
    if (!price) return { ok: false, symbol, reason: 'Yahoo 未返回有效价格' };
    const previousClose = parseNumber(meta.chartPreviousClose);
    const change = previousClose == null ? null : price - previousClose;
    const timestamp = meta.regularMarketTime
      ? new Date(Number(meta.regularMarketTime) * 1000).toISOString()
      : lastTimestamp(result?.timestamp);
    return {
      ok: true,
      symbol,
      quote: {
        symbol,
        price,
        previousClose,
        change,
        changePercent: previousClose ? change / previousClose : null,
        currency: meta.currency || 'USD',
        timestamp,
        source: 'proxy',
        isRealtime: false,
      },
    };
  } catch (error) {
    return { ok: false, symbol, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchNasdaqQuote(symbol) {
  try {
    const upstream = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=stocks`;
    const resp = await fetch(upstream, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
    });
    if (!resp.ok) return { ok: false, symbol, reason: `NASDAQ HTTP ${resp.status}` };
    const data = await resp.json();
    const primary = data?.data?.primaryData;
    const price = parseNumber(primary?.lastSalePrice);
    if (!price) return { ok: false, symbol, reason: 'NASDAQ 未返回有效价格' };
    const change = parseNumber(primary?.netChange);
    return {
      ok: true,
      symbol,
      quote: {
        symbol,
        price,
        previousClose: change == null ? null : price - change,
        change,
        changePercent: parsePercent(primary?.percentageChange),
        currency: 'USD',
        timestamp: primary?.lastTradeTimestamp ?? null,
        source: 'proxy',
        isRealtime: Boolean(primary?.isRealTime),
      },
    };
  } catch (error) {
    return { ok: false, symbol, reason: error instanceof Error ? error.message : String(error) };
  }
}

function uniqueSymbols(raw) {
  return [...new Set(raw.split(',').map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].slice(0, 50);
}

function toYahooSymbol(symbol) {
  return symbol.replace('.', '-');
}

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/[$,%\s,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePercent(value) {
  const parsed = parseNumber(value);
  return parsed == null ? null : parsed / 100;
}

function lastNumber(values) {
  if (!Array.isArray(values)) return null;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const parsed = parseNumber(values[index]);
    if (parsed) return parsed;
  }
  return null;
}

function lastTimestamp(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const last = Number(values[values.length - 1]);
  return Number.isFinite(last) ? new Date(last * 1000).toISOString() : null;
}

function jsonResponse(payload, cors) {
  return new Response(JSON.stringify(payload), {
    headers: {
      ...cors,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
