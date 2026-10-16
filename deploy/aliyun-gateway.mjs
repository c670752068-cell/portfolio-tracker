/**
 * Private portfolio gateway for the Aliyun deployment.
 *
 * It intentionally does not store any AI API key. The browser sends its own
 * Key in the Authorization header, and the gateway serialises requests per
 * hashed key before forwarding them to the selected provider. This prevents
 * accidental parallel "test connection" + "parse screenshot" requests from
 * causing account-level rate-limit errors.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { get as httpsGet } from 'node:https';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { rename } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { createGzip, gzipSync } from 'node:zlib';
import {
  createAlertRulesRoute,
  sendBarkNotification,
} from './alert-tracker.mjs';
import {
  CHANNEL_REVIEW_INTERVAL_MS,
  createChannelReviewRoute,
  readChannelReview,
  runChannelReviewCycle,
} from './channel-review.mjs';
import { createRefreshRequestRoute } from './refresh-request-route.mjs';
import { deliverQuantDecisionAlerts } from './quant-decision-alerts.mjs';
import { createNotificationControl, inQuietHours, scheduleDue, zonedParts } from './notification-control.mjs';
import { classifyMarketSession } from './market-session.mjs';
import { buildYahooChartUrl, parseYahooChartQuote } from './yahoo-quote.mjs';
import { createLastGoodCache } from './last-good-cache.mjs';
import {
  captureNav,
  captureTrades,
  createDecisionLogRoute,
  dropStoredSnapshotArtifacts,
  readDecisionLog,
  writeDecisionLog,
} from './decision-log.mjs';
import { resolveDecisionLog, resolveSymbols } from './decision-log-resolve.mjs';
import {
  appendAlerts,
  applyStateAlerts,
  createAlertLogRoute,
  qqqDrawdownEvents,
  readAlertLog,
  writeAlertLog,
} from './alert-log.mjs';
import { saneSellPricePlan, sellPriceReference } from './sell-price-sanity.mjs';
import { SESSION_CADENCE_MS } from './realtime-alerts.mjs';
import { intradayZFromDashboard, monitorSymbols, runRealtimeTick } from './realtime-monitor.mjs';
import { quietSummaryEvent, realtimeDefaults } from './realtime-push.mjs';
import { createSectorRotationRoute } from './sector-rotation.mjs';
import {
  buildYahooSlopeChartUrl,
  normalizeSlopeDashboardRange,
  normalizeSlopeQuerySymbol,
  normalizeSlopeWindow,
  parseYahooSlopeDashboard,
  parseYahooSlopeHistory,
} from './ma-slope-query.mjs';

const PORT = Number(process.env.PORT || 8789);
const HOST = process.env.HOST || '127.0.0.1';
const STATIC_ROOT = process.env.STATIC_ROOT ? resolve(process.env.STATIC_ROOT) : '';
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 180_000;
const requestQueues = new Map();
const IMPORT_ARCHIVE_TOKEN = process.env.IMPORT_ARCHIVE_TOKEN || '';
const IMPORT_ARCHIVE_ROOT = resolve(process.env.IMPORT_ARCHIVE_ROOT || '/opt/portfolio-tracker-data/imports');
const IMPORT_ARCHIVE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const IMPORT_ARCHIVE_MAX_BYTES = 200 * 1024 * 1024;
const PORTFOLIO_SYNC_TOKEN = process.env.PORTFOLIO_SYNC_TOKEN || '';
const PORTFOLIO_POSITIONS_ROOT = resolve(process.env.PORTFOLIO_POSITIONS_ROOT || '/opt/portfolio-tracker-data/positions');
const PORTFOLIO_POSITIONS_MAX_BYTES = 2 * 1024 * 1024;
const PORTFOLIO_ANALYSIS_ROOT = resolve(process.env.PORTFOLIO_ANALYSIS_ROOT || '/opt/portfolio-tracker-data/analysis');
const PORTFOLIO_REFRESH_REQUEST_PATH = resolve(process.env.PORTFOLIO_REFRESH_REQUEST_PATH || '/opt/portfolio-tracker-data/refresh-request.json');
const PORTFOLIO_ALERTS_ROOT = resolve(process.env.PORTFOLIO_ALERTS_ROOT || '/opt/portfolio-tracker-data/alerts');
const BARK_DEVICE_KEY = process.env.BARK_DEVICE_KEY || '';
const QUANT_DECISION_INTERVAL_MS = 60 * 1000;
const BARK_BASE_URL = process.env.BARK_BASE_URL || 'https://api.day.app';
const MA_SLOPE_CACHE_TTL_MS = 15 * 60 * 1000;
const MA_SLOPE_DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000;
const MA_SLOPE_CACHE_MAX = 256;
const MA_SLOPE_RATE_WINDOW_MS = 60 * 1000;
const MA_SLOPE_RATE_MAX = 60;
const maSlopeCache = createLastGoodCache({ maxEntries: MA_SLOPE_CACHE_MAX });
const maSlopeRateWindows = new Map();
const handleSectorRotationRoute = createSectorRotationRoute({
  fetchJson: getJsonOverIpv4,
  sendJson,
  cacheRoot: join(PORTFOLIO_ANALYSIS_ROOT, '..', 'relative-strength-cache'),
});

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
  sendJsonText(res, status, JSON.stringify(payload));
}

function sendJsonText(res, status, payload) {
  const body = Buffer.from(payload);
  const shouldGzip = Boolean(res.portfolioAcceptsGzip && body.length >= 1024);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Accept-Encoding',
  };
  if (shouldGzip) headers['Content-Encoding'] = 'gzip';
  res.writeHead(status, headers);
  res.end(shouldGzip ? gzipSync(body) : body);
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
    void archiveImageImport(body, Buffer.from(payload)).catch((error) => {
      console.error('portfolio import archive failed:', error);
    });
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

function importArchiveNotFound(res) {
  sendJson(res, 404, { error: { code: 'not_found', message: '未知接口' } });
}

function archiveTokenMatches(url) {
  return Boolean(IMPORT_ARCHIVE_TOKEN) && url.searchParams.get('token') === IMPORT_ARCHIVE_TOKEN;
}

function extractDataUrlImages(body) {
  let parsed;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    return [];
  }
  const images = [];
  for (const message of Array.isArray(parsed?.messages) ? parsed.messages : []) {
    for (const part of Array.isArray(message?.content) ? message.content : []) {
      const url = part?.type === 'image_url' ? part?.image_url?.url : '';
      const match = typeof url === 'string'
        ? url.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=\r\n]+)$/)
        : null;
      if (match) images.push(Buffer.from(match[1], 'base64'));
    }
  }
  return images;
}

function archiveTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

async function archiveImageImport(body, responsePayload) {
  if (!IMPORT_ARCHIVE_TOKEN) return;
  const images = extractDataUrlImages(body);
  if (images.length === 0) return;
  let request;
  try {
    request = JSON.parse(body.toString('utf8'));
  } catch {
    return;
  }
  const now = new Date();
  const id = `${archiveTimestamp(now)}-${randomBytes(3).toString('hex')}`;
  const directory = join(IMPORT_ARCHIVE_ROOT, id);
  await mkdir(directory, { recursive: true });
  await Promise.all(images.map((image, index) => writeFile(join(directory, `image-${index + 1}.jpg`), image)));
  await writeFile(join(directory, 'request-meta.json'), JSON.stringify({
    model: typeof request?.model === 'string' ? request.model : '',
    time: now.toISOString(),
    imageCount: images.length,
  }, null, 2));
  await writeFile(join(directory, 'response.json'), responsePayload);
  await cleanupImportArchives(now.getTime());
}

async function archiveDirectories() {
  try {
    return (await readdir(IMPORT_ARCHIVE_ROOT, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^[A-Za-z0-9_-]+$/.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function archiveDirectoryInfo(id) {
  const directory = join(IMPORT_ARCHIVE_ROOT, id);
  const [directoryStat, files] = await Promise.all([stat(directory), readdir(directory)]);
  let size = 0;
  for (const file of files) {
    if (!/^[A-Za-z0-9._-]+$/.test(file)) continue;
    const fileStat = await stat(join(directory, file));
    if (fileStat.isFile()) size += fileStat.size;
  }
  return { id, directory, mtimeMs: directoryStat.mtimeMs, size };
}

async function cleanupImportArchives(nowMs) {
  const infos = (await Promise.all((await archiveDirectories()).map(archiveDirectoryInfo)))
    .sort((left, right) => left.mtimeMs - right.mtimeMs);
  const retained = [];
  for (const info of infos) {
    if (nowMs - info.mtimeMs > IMPORT_ARCHIVE_MAX_AGE_MS) {
      await rm(info.directory, { recursive: true, force: true });
    } else {
      retained.push(info);
    }
  }
  let totalBytes = retained.reduce((sum, info) => sum + info.size, 0);
  for (const info of retained) {
    if (totalBytes <= IMPORT_ARCHIVE_MAX_BYTES) break;
    await rm(info.directory, { recursive: true, force: true });
    totalBytes -= info.size;
  }
}

async function listImportArchives() {
  const rows = [];
  for (const id of await archiveDirectories()) {
    try {
      const meta = JSON.parse(await readFile(join(IMPORT_ARCHIVE_ROOT, id, 'request-meta.json'), 'utf8'));
      rows.push({
        id,
        time: typeof meta.time === 'string' ? meta.time : '',
        imageCount: Number(meta.imageCount) || 0,
        model: typeof meta.model === 'string' ? meta.model : '',
      });
    } catch {
      // Ignore incomplete archive directories.
    }
  }
  return rows.sort((left, right) => right.time.localeCompare(left.time)).slice(0, 100);
}

async function handleImportArchiveRoute(url, req, res) {
  if (url.pathname !== '/api/imports' && !url.pathname.startsWith('/api/imports/')) return false;
  if (req.method !== 'GET' || !archiveTokenMatches(url)) {
    importArchiveNotFound(res);
    return true;
  }
  if (url.pathname === '/api/imports') {
    sendJson(res, 200, await listImportArchives());
    return true;
  }
  const match = url.pathname.match(/^\/api\/imports\/([A-Za-z0-9_-]+)\/([A-Za-z0-9._-]+)$/);
  if (!match) {
    importArchiveNotFound(res);
    return true;
  }
  const [, id, file] = match;
  const filePath = resolve(IMPORT_ARCHIVE_ROOT, id, file);
  const directory = resolve(IMPORT_ARCHIVE_ROOT, id);
  if (!filePath.startsWith(`${directory}/`)) {
    importArchiveNotFound(res);
    return true;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
  } catch {
    importArchiveNotFound(res);
    return true;
  }
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(filePath).pipe(res);
  return true;
}

async function readPositionsBody(req) {
  let total = 0;
  const parts = [];
  for await (const part of req) {
    total += part.length;
    if (total > PORTFOLIO_POSITIONS_MAX_BYTES) {
      const error = new Error('请求体超过 2MB 限制');
      error.status = 413;
      throw error;
    }
    parts.push(part);
  }
  return Buffer.concat(parts);
}

function positionsRouteNotFound(res) {
  sendJson(res, 404, { error: { code: 'not_found', message: '未知接口' } });
}

function positionsAuthorizationMatches(req) {
  return Boolean(PORTFOLIO_SYNC_TOKEN)
    && req.headers.authorization === `Bearer ${PORTFOLIO_SYNC_TOKEN}`;
}

async function handlePortfolioPositionsRoute(url, req, res) {
  if (url.pathname !== '/api/portfolio/positions') return false;
  const latestPath = join(PORTFOLIO_POSITIONS_ROOT, 'latest.json');
  if (req.method === 'GET') {
    try {
      const payload = await readFile(latestPath, 'utf8');
      sendJsonText(res, 200, payload);
    } catch {
      sendJson(res, 404, { error: { code: 'no_data', message: '尚无量化系统持仓数据' } });
    }
    return true;
  }
  if (!PORTFOLIO_SYNC_TOKEN) {
    positionsRouteNotFound(res);
    return true;
  }
  if (!positionsAuthorizationMatches(req)) {
    sendJson(res, 401, { error: { code: 'unauthorized', message: '认证失败' } });
    return true;
  }
  if (req.method !== 'POST') {
    positionsRouteNotFound(res);
    return true;
  }
  let body;
  try {
    body = await readPositionsBody(req);
  } catch (error) {
    sendJson(res, error.status || 400, { error: { code: 'request_body_error', message: error.message } });
    return true;
  }
  let snapshot;
  try {
    snapshot = JSON.parse(body.toString('utf8'));
  } catch {
    sendJson(res, 400, { error: { code: 'invalid_json', message: '请求体不是合法 JSON' } });
    return true;
  }
  if (!Array.isArray(snapshot?.payload?.positions) || typeof snapshot?.payload?.net_liquidation !== 'number' || !Number.isFinite(snapshot.payload.net_liquidation)) {
    sendJson(res, 400, { error: { code: 'invalid_payload', message: 'payload.positions 必须为数组，payload.net_liquidation 必须为数字' } });
    return true;
  }
  if (snapshot.source !== 'futu-assistant' || typeof snapshot.pushed_at !== 'string' || Number.isNaN(Date.parse(snapshot.pushed_at))) {
    sendJson(res, 400, { error: { code: 'invalid_envelope', message: 'source 或 pushed_at 不合法' } });
    return true;
  }
  await mkdir(PORTFOLIO_POSITIONS_ROOT, { recursive: true });
  const temporaryPath = join(PORTFOLIO_POSITIONS_ROOT, `.latest-${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
  try {
    await writeFile(temporaryPath, body, { mode: 0o600 });
    await rename(temporaryPath, latestPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  sendJson(res, 200, { ok: true, position_count: snapshot.payload.positions.length, pushed_at: snapshot.pushed_at });
  return true;
}

async function handlePortfolioAnalysisRoute(url, req, res) {
  if (url.pathname !== '/api/portfolio/quant-analysis') return false;
  const latestPath = join(PORTFOLIO_ANALYSIS_ROOT, 'latest.json');
  if (req.method === 'GET') {
    try {
      const payload = await readFile(latestPath, 'utf8');
      sendJsonText(res, 200, payload);
    } catch {
      sendJson(res, 404, { error: { code: 'no_data', message: '尚无量化分析数据' } });
    }
    return true;
  }
  if (!PORTFOLIO_SYNC_TOKEN) {
    positionsRouteNotFound(res);
    return true;
  }
  if (!positionsAuthorizationMatches(req)) {
    sendJson(res, 401, { error: { code: 'unauthorized', message: '认证失败' } });
    return true;
  }
  if (req.method !== 'POST') {
    positionsRouteNotFound(res);
    return true;
  }
  let body;
  try {
    body = await readPositionsBody(req);
  } catch (error) {
    sendJson(res, error.status || 400, { error: { code: 'request_body_error', message: error.message } });
    return true;
  }
  let snapshot;
  try {
    snapshot = JSON.parse(body.toString('utf8'));
  } catch {
    sendJson(res, 400, { error: { code: 'invalid_json', message: '请求体不是合法 JSON' } });
    return true;
  }
  const symbolsValid = snapshot?.symbols && typeof snapshot.symbols === 'object' && !Array.isArray(snapshot.symbols);
  const generatedAtValid = typeof snapshot?.generated_at === 'string' && !Number.isNaN(Date.parse(snapshot.generated_at));
  if (snapshot?.source !== 'futu-assistant' || typeof snapshot?.rule_version !== 'string' || !symbolsValid || !generatedAtValid) {
    sendJson(res, 400, { error: { code: 'invalid_envelope', message: '量化分析 source、generated_at、rule_version 或 symbols 不合法' } });
    return true;
  }
  await mkdir(PORTFOLIO_ANALYSIS_ROOT, { recursive: true });
  const temporaryPath = join(PORTFOLIO_ANALYSIS_ROOT, `.latest-${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
  try {
    await writeFile(temporaryPath, body, { mode: 0o600 });
    await rename(temporaryPath, latestPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  await captureDecisionLogFromSnapshot(snapshot);
  await captureAlertsFromSnapshot(snapshot);
  sendJson(res, 200, {
    ok: true,
    symbol_count: Object.keys(snapshot.symbols).length,
    generated_at: snapshot.generated_at,
    alerts_sent: 0,
  });
  return true;
}

async function handleMaSlopeQueryRoute(url, req, res) {
  if (url.pathname !== '/api/portfolio/ma-slope') return false;
  if (req.method !== 'GET') {
    positionsRouteNotFound(res);
    return true;
  }
  let symbol;
  try {
    symbol = normalizeSlopeQuerySymbol(url.searchParams.get('symbol'));
  } catch (error) {
    sendJson(res, 400, { error: { code: 'invalid_symbol', message: error.message } });
    return true;
  }
  if (!consumeMaSlopeRate(req)) {
    sendJson(res, 429, { error: { code: 'rate_limited', message: '查询太频繁，请一分钟后再试' } });
    return true;
  }
  if (url.searchParams.get('view') === 'dashboard') {
    await handleMaSlopeDashboard(url, symbol, res);
    return true;
  }
  const stored = await readStoredMaSlope(symbol);
  if (stored) {
    sendJson(res, 200, stored);
    return true;
  }
  const cached = readMaSlopeCache(symbol);
  if (cached) {
    sendJson(res, 200, cached);
    return true;
  }
  try {
    const data = await getJsonOverIpv4(
      buildYahooSlopeChartUrl(symbol),
      { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      12_000,
    );
    if (!data?.chart?.result?.[0]) throw new Error('no chart result');
    const result = parseYahooSlopeHistory(symbol, data);
    writeMaSlopeCache(symbol, result);
    sendJson(res, 200, result);
  } catch {
    sendJson(res, 422, {
      error: { code: 'slope_history_unavailable', message: '找不到该股票或历史行情不足' },
    });
  }
  return true;
}

async function handleMaSlopeDashboard(url, symbol, res) {
  let range;
  let slopeWindow;
  try {
    range = normalizeSlopeDashboardRange(url.searchParams.get('range') || '5y');
    slopeWindow = normalizeSlopeWindow(url.searchParams.get('slope_window') || '8');
  } catch (error) {
    sendJson(res, 400, { error: { code: 'invalid_chart_options', message: error.message } });
    return;
  }
  const cacheKey = `dashboard:${symbol}:${range}:${slopeWindow}`;
  const forceRefresh = url.searchParams.get('refresh') === '1';
  const cached = forceRefresh
    ? null
    : readMaSlopeCache(cacheKey, MA_SLOPE_DASHBOARD_CACHE_TTL_MS);
  if (cached) {
    sendJson(res, 200, cached);
    return;
  }
  try {
    const data = await getJsonOverIpv4(
      buildYahooSlopeChartUrl(symbol, range),
      { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      15_000,
    );
    if (!data?.chart?.result?.[0]) throw new Error('no chart result');
    const result = parseYahooSlopeDashboard(symbol, data, { range, slopeWindow });
    writeMaSlopeCache(cacheKey, result);
    sendJson(res, 200, result);
  } catch (error) {
    // 行情刷新失败时保留上一份完整数据，页面不清空；日期仍是那份数据自己的日期。
    const lastGood = maSlopeCache.lastGood(cacheKey);
    if (lastGood) {
      console.warn(
        `ma-slope dashboard refresh failed, serving last complete data: ${symbol} ${range}/${slopeWindow}`
        + ` as_of=${lastGood.as_of ?? 'unknown'}`
        + ` reason=${error instanceof Error ? error.message : String(error)}`,
      );
      sendJson(res, 200, lastGood);
      return;
    }
    console.warn(
      `ma-slope dashboard unavailable and no previous data cached: ${symbol} ${range}/${slopeWindow}`
      + ` reason=${error instanceof Error ? error.message : String(error)}`,
    );
    sendJson(res, 422, {
      error: { code: 'slope_dashboard_unavailable', message: '找不到该股票或 K 线历史行情不足' },
    });
  }
}

async function readStoredMaSlope(symbol) {
  const path = join(PORTFOLIO_ANALYSIS_ROOT, 'latest.json');
  try {
    const snapshot = JSON.parse(await readFile(path, 'utf8'));
    const stored = snapshot?.symbols?.[symbol]?.ma_slope;
    if (!stored || typeof stored !== 'object') return null;
    return {
      ...stored,
      symbol,
      decision_use: false,
      query_source: 'decision_snapshot',
    };
  } catch {
    return null;
  }
}

function consumeMaSlopeRate(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const key = forwarded || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const current = maSlopeRateWindows.get(key);
  if (!current || now - current.startedAt >= MA_SLOPE_RATE_WINDOW_MS) {
    maSlopeRateWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= MA_SLOPE_RATE_MAX;
}

function readMaSlopeCache(symbol, ttlMs = MA_SLOPE_CACHE_TTL_MS) {
  return maSlopeCache.fresh(symbol, ttlMs);
}

function writeMaSlopeCache(symbol, result) {
  maSlopeCache.store(symbol, result);
}

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/[$,%\s,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
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
  const url = buildYahooChartUrl(symbol);
  const data = await getJsonOverIpv4(url, { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }, 8_000);
  return parseYahooChartQuote(symbol, data);
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

const handleAlertRulesRoute = createAlertRulesRoute({
  alertsRoot: PORTFOLIO_ALERTS_ROOT,
  sendJson,
  token: PORTFOLIO_SYNC_TOKEN,
});
const notificationControl = createNotificationControl({
  root: PORTFOLIO_ALERTS_ROOT, token: PORTFOLIO_SYNC_TOKEN, sendJson,
  send: ({ title, body, presentation }) => sendBarkNotification({ baseUrl: BARK_BASE_URL, deviceKey: BARK_DEVICE_KEY, title, body, presentation }),
});
const handleChannelReviewRoute = createChannelReviewRoute({
  alertsRoot: PORTFOLIO_ALERTS_ROOT,
  sendJson,
});
const handleAlertLogRoute = createAlertLogRoute({
  root: PORTFOLIO_ALERTS_ROOT,
  sendJson,
});
const handleDecisionLogRoute = createDecisionLogRoute({
  root: PORTFOLIO_ALERTS_ROOT,
  sendJson,
  readBody: readPositionsBody,
});

// 量化快照一上传就把推算成交和当日净值抓进决策日志：recent_events 只留最近
// 50 条，不落盘就会滚掉；每日净值也只有从现在开始攒才有时间加权收益率可算。
// 手机推送的唯一出口：推一条就在提醒日志里记一行，推送开关关掉也照样记，
// 只是标「未推送」。
async function dispatchAndLogAlert(event, extra = {}) {
  const result = await notificationControl.dispatch(event);
  try {
    const store = await readAlertLog(PORTFOLIO_ALERTS_ROOT);
    const next = appendAlerts(store, [{
      dedupe_key: `push:${String(event?.dedupeKey || event?.key || '')}`,
      category: alertCategoryForEvent(event),
      symbol: typeof event?.symbol === 'string' ? event.symbol : null,
      icon: '🔔',
      text: [event?.title, event?.body].filter(Boolean).join(' · ') || '推送',
      pushed: result?.status === 'sent',
      occurred_at: typeof event?.createdAt === 'string' ? event.createdAt : undefined,
      ...extra,
    }]);
    if (next !== store) await writeAlertLog(PORTFOLIO_ALERTS_ROOT, next);
  } catch (error) {
    console.warn(`alert log write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return result;
}

function alertCategoryForEvent(event) {
  const key = `${String(event?.key || '')} ${String(event?.title || '')}`;
  if (/drawdown|回撤|深回撤/.test(key)) return 'drawdown';
  if (/cnn|vix|恐慌|情绪/i.test(key)) return 'sentiment';
  if (/pe|估值/i.test(key)) return 'valuation';
  if (/z|通道|露头/i.test(key)) return 'zscore';
  if (/sell|卖出|止盈/i.test(key)) return 'sell_line';
  if (/仓位|预算|杠杆|期权/.test(key)) return 'position';
  return 'other';
}

// 取某个标的的完整收盘日线：先用缓存（含过期兜底），没有再抓一次 Yahoo。
async function closedDailySeries(symbol) {
  const cacheKey = `dashboard:${symbol}:5y:8`;
  const cached = readMaSlopeCache(cacheKey, MA_SLOPE_DASHBOARD_CACHE_TTL_MS) || maSlopeCache.lastGood(cacheKey);
  let result = cached;
  if (!result) {
    try {
      const data = await getJsonOverIpv4(
        buildYahooSlopeChartUrl(symbol, '5y'),
        { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
        15_000,
      );
      if (!data?.chart?.result?.[0]) throw new Error('no chart result');
      result = parseYahooSlopeDashboard(symbol, data, { range: '5y', slopeWindow: 8 });
      writeMaSlopeCache(cacheKey, result);
    } catch (error) {
      console.warn(`decision log resolve could not load ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  return (result.dashboard?.series || [])
    .filter((point) => point && point.is_partial !== true && Number.isFinite(point.close))
    .map((point) => ({ date: point.date, close: point.close }));
}

// 每天收盘审查之后判定一次预判结果：只读行情，不碰阈值，也不发通知。
async function runDecisionLogResolveCycle(today) {
  try {
    const store = await readDecisionLog(PORTFOLIO_ALERTS_ROOT);
    const symbols = resolveSymbols(store);
    if (symbols.length === 0) return;
    const series = new Map();
    for (const symbol of symbols) series.set(symbol, await closedDailySeries(symbol));
    const next = resolveDecisionLog(store, {
      seriesFor: (symbol) => series.get(String(symbol).toUpperCase()) || [],
      today,
    });
    if (next !== store) {
      await writeDecisionLog(PORTFOLIO_ALERTS_ROOT, next);
      console.warn(`decision log resolved predictions on ${today}`);
    }
  } catch (error) {
    console.warn(`decision log resolve failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function alertNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// 快照一上传就把「回撤档位、警戒线、卖出军令」这三类写进提醒日志。
// 回撤档位默认只记日志、不推手机（用户要的默认值）。
async function captureAlertsFromSnapshot(snapshot) {
  try {
    const store = await readAlertLog(PORTFOLIO_ALERTS_ROOT);
    const series = await closedDailySeries('QQQ');
    const oneYearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const today = etDateString(new Date());
    const drawdowns = qqqDrawdownEvents(series, { from: oneYearAgo }).map((event) => ({
      dedupe_key: event.dedupe_key,
      category: event.category,
      symbol: event.symbol,
      icon: event.icon,
      text: event.text,
      value: event.value,
      threshold: event.threshold,
      session: 'closed',
      // 今天之前的都是用历史行情补的，标「回填」，也不算推送过
      backfilled: event.date < today,
      pushed: false,
      occurred_at: `${event.date}T20:30:00.000Z`,
    }));
    const withDrawdowns = appendAlerts(store, drawdowns);

    const context = snapshot?.context || {};
    const cnn = alertNumber(context?.cnn_fear_greed?.score);
    const vix = alertNumber(context?.vix?.value);
    const ndxPe = alertNumber(snapshot?.valuation_tab?.ndx?.current_pe);
    const readings = [];
    if (cnn !== null) {
      readings.push({
        key: 'cnn', state: cnn < 30 ? 'triggered' : 'normal', category: 'sentiment', symbol: 'CNN',
        icon: cnn < 30 ? '😨' : '🙂', value: cnn, threshold: 30,
        text: cnn < 30 ? `CNN 恐惧贪婪 ${cnn.toFixed(0)} < 30 · 到达开仓线` : `CNN 恐惧贪婪 ${cnn.toFixed(0)} 回到 30 以上 · 离开开仓线`,
      });
    }
    if (vix !== null) {
      readings.push({
        key: 'vix', state: vix > 23 ? 'triggered' : 'normal', category: 'sentiment', symbol: 'VIX',
        icon: vix > 23 ? '⚡' : '🙂', value: vix, threshold: 23,
        text: vix > 23 ? `VIX ${vix.toFixed(2)} > 23 · 超过警戒线` : `VIX ${vix.toFixed(2)} 回到 23 以下 · 离开警戒线`,
      });
    }
    if (ndxPe !== null) {
      readings.push({
        key: 'ndx-pe', state: ndxPe >= 35 ? 'triggered' : 'normal', category: 'valuation', symbol: 'NDX',
        icon: ndxPe >= 35 ? '⚠️' : '🙂', value: ndxPe, threshold: 35,
        text: ndxPe >= 35 ? `纳指100 PE ${ndxPe.toFixed(2)} ≥ 35 · 到达警戒线` : `纳指100 PE ${ndxPe.toFixed(2)} 回到 35 以下 · 离开警戒线`,
      });
    }
    for (const [symbol, family] of Object.entries(snapshot?.sell?.symbols || {})) {
      const decision = family?.decision || {};
      const ready = decision.verdict === 'SELL' && decision.notification_state === 'sell';
      const plan = family?.sell_price_plan || {};
      const trigger = alertNumber(plan.trigger_price) ?? alertNumber(plan.sell_price);
      readings.push({
        key: `sell:${symbol}`, state: ready ? 'triggered' : 'normal', category: 'sell_line', symbol,
        icon: ready ? '💰' : '🙂', threshold: trigger,
        text: ready
          ? `${symbol} 卖出军令变为可执行${trigger === null ? '' : ` · 卖出线 ${trigger.toFixed(2)}`}${decision.reason ? ` · ${decision.reason}` : ''}`
          : `${symbol} 卖出军令退回等待`,
      });
    }
    const next = applyStateAlerts(withDrawdowns, readings);
    if (next !== store) await writeAlertLog(PORTFOLIO_ALERTS_ROOT, next);
  } catch (error) {
    console.warn(`alert log capture failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function etDateString(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function captureDecisionLogFromSnapshot(snapshot) {
  try {
    const review = await readChannelReview(PORTFOLIO_ALERTS_ROOT).catch(() => null);
    const current = await readDecisionLog(PORTFOLIO_ALERTS_ROOT);
    const withTrades = captureTrades(current, snapshot, { channelReview: review });
    const withNav = captureNav(withTrades, snapshot);
    // 一对伪影可能跨两次抓取才凑齐，抓完再清一遍已存的。
    const next = dropStoredSnapshotArtifacts(withNav);
    if (next.revision !== current.revision) await writeDecisionLog(PORTFOLIO_ALERTS_ROOT, next);
    // 新抓到的成交同时写一条持仓变化提醒
    const freshTrades = next.trades.filter((trade) => !current.trades.some((item) => item.id === trade.id));
    if (freshTrades.length) {
      try {
        const store = await readAlertLog(PORTFOLIO_ALERTS_ROOT);
        const updated = appendAlerts(store, freshTrades.map((trade) => ({
          dedupe_key: `holdings:${trade.key}`,
          category: 'position',
          symbol: trade.symbol,
          icon: '🧾',
          text: `${trade.broker || '券商'} · ${trade.side === 'BUY' ? '买入' : '卖出'} ${trade.symbol} ${trade.qty} ${
            trade.price === null ? '（价格待补）' : `@ $${Number(trade.price).toFixed(2)}`
          } · 已同步到决策日志，待补充理由`,
          value: trade.price,
          pushed: false,
          occurred_at: trade.trade_time,
        })));
        if (updated !== store) await writeAlertLog(PORTFOLIO_ALERTS_ROOT, updated);
      } catch (error) {
        console.warn(`holdings alert failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    // 抓日志失败绝不能让快照上传失败。
    console.warn(`decision log capture failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
const handleRefreshRequestRoute = createRefreshRequestRoute({
  token: PORTFOLIO_SYNC_TOKEN,
  filePath: PORTFOLIO_REFRESH_REQUEST_PATH,
  sendJson,
});

let quantDecisionCycleRunning = false;
async function runStoredQuantDecisionCycle() {
  if (quantDecisionCycleRunning) return;
  quantDecisionCycleRunning = true;
  try {
    const snapshot = JSON.parse(await readFile(join(PORTFOLIO_ANALYSIS_ROOT, 'latest.json'), 'utf8'));
    const now = new Date();
    const settings = await notificationControl.settings();
    const age = +now - Date.parse(snapshot.generated_at);
    if (!Number.isFinite(age) || age < -60_000 || age > 6 * 60 * 60 * 1000) return;
    if (classifyMarketSession(now, { hasMinuteSeries: true }) === 'closed') return;
    for (const schedule of settings.schedules.filter(s => s.source === 'server' && scheduleDue(s, now))) {
      const slot = `${zonedParts(now, schedule.timeZone).date}:${schedule.id}`;
      await deliverQuantDecisionAlerts({ snapshot, alertsRoot: PORTFOLIO_ALERTS_ROOT, now, notificationSlot: slot,
        notify: async event => {
          const result = await dispatchAndLogAlert({ ...event, scheduleId: schedule.id,
            dedupeKey: `${slot}:${event.key}`, createdAt: now.toISOString() });
          return result.status === 'sent';
        },
      });
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('stored quant decision cycle failed:', error instanceof Error ? error.message : String(error));
    }
  } finally {
    quantDecisionCycleRunning = false;
  }
}

let channelReviewCycleRunning = false;
async function runStoredChannelReviewCycle() {
  if (channelReviewCycleRunning) return;
  channelReviewCycleRunning = true;
  try {
    const snapshot = JSON.parse(await readFile(join(PORTFOLIO_ANALYSIS_ROOT, 'latest.json'), 'utf8'));
    const positions = await readFile(join(PORTFOLIO_POSITIONS_ROOT, 'latest.json'), 'utf8')
      .then(raw => JSON.parse(raw)?.payload?.positions).catch(() => []);
    const review = await runChannelReviewCycle({
      snapshot,
      positions: Array.isArray(positions) ? positions : [],
      alertsRoot: PORTFOLIO_ALERTS_ROOT,
      notify: event => dispatchAndLogAlert(event),
      extremeRule: (await notificationControl.settings()).zExtreme,
      fetchDashboard: async (symbol, now) => {
        const data = await getJsonOverIpv4(
          buildYahooSlopeChartUrl(symbol, '5y'),
          { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
          15_000,
        );
        if (!data?.chart?.result?.[0]) throw new Error('no chart result');
        return parseYahooSlopeDashboard(symbol, data, { range: '5y', slopeWindow: 8, now });
      },
    });
    if (review && review.skipped !== true && review.review_date) {
      await runDecisionLogResolveCycle(review.review_date);
    }
    // 刷新失败只记日志，服务器上保留的仍是上一份完整收盘审查。
    if (review?.failed_symbols?.length) {
      console.warn(
        `channel review kept the previous complete close for ${review.failed_symbols.length} symbols:`
        + ` ${review.failed_symbols.join(',')}`,
      );
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('stored channel review cycle failed:', error instanceof Error ? error.message : String(error));
    }
  } finally {
    channelReviewCycleRunning = false;
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
  const compressible = ['.css', '.html', '.js', '.json', '.svg'].includes(extension);
  const shouldGzip = Boolean(res.portfolioAcceptsGzip && compressible);
  const headers = {
    'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
    'Cache-Control': extension === '.html' || extension === '.js' && filePath.endsWith('runtime-config.js') ? 'no-cache' : 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Accept-Encoding',
  };
  if (shouldGzip) headers['Content-Encoding'] = 'gzip';
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
  } else {
    const source = createReadStream(filePath);
    if (shouldGzip) source.pipe(createGzip()).pipe(res);
    else source.pipe(res);
  }
  return true;
}

const server = createServer(async (req, res) => {
  res.portfolioAcceptsGzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(req.headers['accept-encoding'] || '');
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (await handleSectorRotationRoute(url, req, res)) return;
  if (await notificationControl.route(url, req, res)) return;
  if (await handleImportArchiveRoute(url, req, res)) return;
  if (await handleRefreshRequestRoute(url, req, res)) return;
  if (await handlePortfolioPositionsRoute(url, req, res)) return;
  try {
    if (await handlePortfolioAnalysisRoute(url, req, res)) return;
  } catch (error) {
    console.error('quant analysis route failed:', error instanceof Error ? error.message : String(error));
    if (!res.headersSent) sendJson(res, 500, { error: { code: 'quant_analysis_error', message: '量化分析服务暂不可用' } });
    else res.destroy();
    return;
  }
  if (await handleMaSlopeQueryRoute(url, req, res)) return;
  if (await handleChannelReviewRoute(url, req, res)) return;
  if (await handleDecisionLogRoute(url, req, res)) return;
  if (await handleAlertLogRoute(url, req, res)) return;
  try {
    if (await handleAlertRulesRoute(url, req, res)) return;
  } catch (error) {
    console.error('alert rules route failed:', error instanceof Error ? error.message : String(error));
    if (!res.headersSent) sendJson(res, 500, { error: { code: 'alert_rules_error', message: '提醒规则服务暂不可用' } });
    else res.destroy();
    return;
  }
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

// 实时监控：盘中 1 分钟、盘前盘后 2 分钟、夜盘 5 分钟，休市 15 分钟。
// 新提醒默认只写日志不推送（开关在设置里，默认全关）。
const REALTIME_STATE = { lastTickAt: 0, lastCnn: null, quietQueue: [], wasQuiet: false, running: false };
const REALTIME_TICK_MS = 30 * 1000;

async function runRealtimeMonitorCycle() {
  if (REALTIME_STATE.running) return;
  const now = new Date();
  const session = classifyMarketSession(now, { hasMinuteSeries: true });
  const cadence = SESSION_CADENCE_MS[session] ?? SESSION_CADENCE_MS.closed;
  if (+now - REALTIME_STATE.lastTickAt < cadence) return;
  REALTIME_STATE.running = true;
  REALTIME_STATE.lastTickAt = +now;
  try {
    const settings = await notificationControl.settings();
    const realtime = settings?.realtime || realtimeDefaults();
    const quiet = inQuietHours(settings, now);

    let snapshot = null;
    try {
      snapshot = JSON.parse(await readFile(join(PORTFOLIO_ANALYSIS_ROOT, 'latest.json'), 'utf8'));
    } catch { snapshot = null; }
    const positions = await readFile(join(PORTFOLIO_POSITIONS_ROOT, 'latest.json'), 'utf8')
      .then((raw) => JSON.parse(raw)?.payload?.positions || []).catch(() => []);
    const held = [...new Set(positions
      .filter((item) => item?.asset_type !== 'option')
      .map((item) => String(item?.symbol || '').toUpperCase().replace(/^US\./, ''))
      .filter(Boolean))];
    const symbols = monitorSymbols({ held, decision: Object.keys(snapshot?.symbols || {}) });

    const quotes = {};
    for (const symbol of symbols) {
      try {
        const quote = await fetchFreeQuote(symbol === 'VIX' ? '^VIX' : symbol);
        if (quote) quotes[symbol] = quote;
      } catch { /* 单个标的取价失败不影响其他 */ }
    }

    const qqqSeries = await closedDailySeries('QQQ');
    const peak = qqqSeries.reduce((best, point) => (!best || point.close > best.close ? point : best), null);

    const intradayZ = {};
    for (const symbol of ['QQQ', ...held].slice(0, 8)) {
      const cached = maSlopeCache.lastGood(`dashboard:${symbol}:5y:8`);
      const reading = intradayZFromDashboard(cached, quotes[symbol]?.price);
      if (reading) intradayZ[symbol] = reading;
    }

    const sellLines = {};
    for (const [symbol, family] of Object.entries(snapshot?.sell?.symbols || {})) {
      // 先过一遍合理性校验：离谱的卖出线（低于现价一半或高于三倍）不参与比价，
      // 否则 TSLA 那种 $30.98 的坏数据会天天报「已到卖出线」。
      const raw = family?.sell_price_plan || {};
      const plan = saneSellPricePlan(raw, sellPriceReference(raw) ?? quotes[symbol]?.price ?? null);
      const trigger = Number(plan?.trigger_price ?? plan?.sell_price);
      if (String(plan?.method || '') !== 'unavailable' && Number.isFinite(trigger) && trigger > 0) {
        sellLines[symbol] = { trigger, label: plan.action_stage_key === 'trim_stock' ? '正股分批' : '开始降风险' };
      }
    }

    const cnnScore = Number(snapshot?.context?.cnn_fear_greed?.score);
    const store = await readAlertLog(PORTFOLIO_ALERTS_ROOT);
    const result = await runRealtimeTick({
      now,
      session,
      store,
      quotes,
      intradayZ,
      sellLines,
      heldSymbols: held,
      qqqPreviousHigh: peak?.close ?? null,
      qqqPeakDate: peak?.date ?? null,
      cnnScore: Number.isFinite(cnnScore) ? cnnScore : null,
      previousCnnScore: REALTIME_STATE.lastCnn,
      settings: realtime,
      quiet,
      dispatch: (event) => notificationControl.dispatch(event),
    });
    if (Number.isFinite(cnnScore)) REALTIME_STATE.lastCnn = cnnScore;
    if (result.store !== store) await writeAlertLog(PORTFOLIO_ALERTS_ROOT, result.store);
    if (result.quietQueue.length) REALTIME_STATE.quietQueue.push(...result.quietQueue);

    // 免打扰刚结束：把期间攒下的重要提醒合成一条发出去
    if (REALTIME_STATE.wasQuiet && !quiet && REALTIME_STATE.quietQueue.length && realtime.enabled && realtime.quietSummary) {
      const summary = quietSummaryEvent(REALTIME_STATE.quietQueue, now);
      REALTIME_STATE.quietQueue = [];
      if (summary) await notificationControl.dispatch(summary);
    } else if (!quiet) {
      REALTIME_STATE.quietQueue = [];
    }
    REALTIME_STATE.wasQuiet = quiet;
  } catch (error) {
    console.warn(`realtime monitor failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    REALTIME_STATE.running = false;
  }
}

const realtimeMonitorTimer = setInterval(runRealtimeMonitorCycle, REALTIME_TICK_MS);
const quantDecisionTimer = setInterval(runStoredQuantDecisionCycle, QUANT_DECISION_INTERVAL_MS);
const channelReviewTimer = setInterval(runStoredChannelReviewCycle, CHANNEL_REVIEW_INTERVAL_MS);
void runStoredQuantDecisionCycle();
void runStoredChannelReviewCycle();
server.on('close', () => {
  clearInterval(realtimeMonitorTimer);
  clearInterval(quantDecisionTimer);
  clearInterval(channelReviewTimer);
});
