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
import { classifyMarketSession, etCloseInstant } from './market-session.mjs';
import { buildYahooChartUrl, parseYahooChartQuote } from './yahoo-quote.mjs';
import { createLastGoodCache } from './last-good-cache.mjs';
import { estimatePositionValues } from './position-estimate.mjs';
import {
  captureNav,
  captureTrades,
  createDecisionLogRoute,
  dropStoredSnapshotArtifacts,
  readDecisionLog,
  repairTradeDates,
  writeDecisionLog,
} from './decision-log.mjs';
import { resolveDecisionLog, resolveSymbols } from './decision-log-resolve.mjs';
import {
  appendAlerts,
  applyStateAlerts,
  createAlertLogRoute,
  alertCategoryForEvent,
  lastKnownCnnScore,
  qqqDrawdownEvents,
  readAlertLog,
  setPushState,
  symbolFromEventKey,
  writeAlertLog,
} from './alert-log.mjs';
import { NOISE_CONFIG_FILE, loadNoiseConfig, planSlotEntries } from './alert-noise.mjs';
import {
  ALERT_OUTCOMES_VERSION, alertOutcomeKind, computeAlertOutcomes, createAlertOutcomesRoute,
  outcomeSymbol, summarizeOutcomes, writeAlertOutcomes,
} from './alert-outcomes.mjs';
import { voidDustRecords } from './void-dust-records.mjs';
import { applyReferencePriceFixes } from './fix-reference-price-alerts.mjs';
import { brokerHealthReadings } from './broker-health.mjs';
import { saneSellPricePlan, sellPriceReference } from './sell-price-sanity.mjs';
import { SESSION_CADENCE_MS, cnnFloorText, sessionLabel } from './realtime-alerts.mjs';
import { estimatedZFromPrice, feedStateReading, intradayZPreview, monitorSymbols, nearBreakoutReading, runRealtimeTick } from './realtime-monitor.mjs';
import { quietSummaryEvent, realtimeDefaults } from './realtime-push.mjs';
import { createIndexQuotesCache, createIndexQuotesRoute, parseIndexQuote } from './index-quotes.mjs';
import { createOvernightQuoteStore, createOvernightQuotesRoute } from './overnight-quotes.mjs';
import { feedOutageReading, markQuoteFreshness, pickOvernightQuote } from './quote-freshness.mjs';
import { portfolioDayLoss } from './portfolio-loss.mjs';
import { buildDataSourceStatus, opendReadingForAlerts } from './data-sources.mjs';
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

// 降噪参数（同标的同类提醒的冷却时间）写在配置文件里，不做成界面开关。
// 读不到或写坏了就用默认值，绝不让网关起不来。
let NOISE_CONFIG = loadNoiseConfig(null);
try {
  NOISE_CONFIG = loadNoiseConfig(JSON.parse(
    await readFile(new URL(NOISE_CONFIG_FILE, import.meta.url), 'utf8'),
  ));
} catch (error) {
  console.warn(`alert noise config fallback to defaults: ${error instanceof Error ? error.message : String(error)}`);
}
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

// 实时轮询顺手存下来的最新报价，持仓接口拿它重算市值，不另外抓行情。
const LIVE_QUOTES = new Map();

async function handlePortfolioPositionsRoute(url, req, res) {
  if (url.pathname !== '/api/portfolio/positions') return false;
  const latestPath = join(PORTFOLIO_POSITIONS_ROOT, 'latest.json');
  if (req.method === 'GET') {
    try {
      const raw = await readFile(latestPath, 'utf8');
      // IBKR 对账晚一个交易日，用最新报价把市值重算一遍，总资产和杠杆预算才是今天的。
      // 重算失败或报价太旧时原样返回券商数据，绝不返回空白。
      try {
        const stored = JSON.parse(raw);
        const quotes = Object.fromEntries(LIVE_QUOTES);
        const estimated = estimatePositionValues(stored?.payload, quotes);
        if (estimated !== stored?.payload) {
          sendJson(res, 200, { ...stored, payload: estimated });
          return true;
        }
      } catch (error) {
        console.warn(`position estimate failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      sendJsonText(res, 200, raw);
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
  // QQQ 这类 ETF 用 assetclass=stocks 会被拒（HTTP 400），要换成 etf
  const classes = ['stocks', 'etf'];
  let data = null;
  for (const assetClass of classes) {
    try {
      data = await getJsonOverIpv4(
        `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=${assetClass}`,
        { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9' },
        12_000,
      );
    } catch {
      data = null;
    }
    if (data?.data?.primaryData?.lastSalePrice) break;
  }
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

// 夜盘（美东 20:00–04:00）：免费源的价格停在 19:59，用富途推上来的夜盘价；
// 推送断了退到 Nasdaq 的最后成交价；都没有就标「夜盘无报价」，不沿用旧价格。
async function fetchOvernightQuote(symbol, now) {
  const pushed = overnightQuotes.get(symbol, now);
  let nasdaq = null;
  if (!pushed) {
    try {
      nasdaq = await fetchNasdaqQuote(symbol);
    } catch { /* 退到下一档 */ }
  }
  let yahoo = null;
  try {
    yahoo = await fetchYahooQuote(symbol);
  } catch { /* 夜盘本来就可能没有 */ }
  const picked = pickOvernightQuote({ pushed, nasdaq, yahoo, now });
  const previousClose = alertNumber(picked.previousClose);
  return {
    symbol,
    currency: 'USD',
    ...picked,
    priceTime: picked.priceTime ?? null,
    timestamp: picked.priceTime ?? null,
    changePercent: picked.price !== null && previousClose ? picked.price / previousClose - 1 : null,
    change: picked.price !== null && previousClose ? picked.price - previousClose : null,
    session: 'overnight',
  };
}

/** 按时段取价，并打上新鲜度标记：过期的一律不再当实时价格。 */
async function fetchSessionQuote(symbol, session, now = new Date()) {
  if (session === 'overnight') return fetchOvernightQuote(symbol, now);
  return markQuoteFreshness(await fetchFreeQuote(symbol), { now, session });
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
const handleAlertOutcomesRoute = createAlertOutcomesRoute({
  root: PORTFOLIO_ALERTS_ROOT,
  sendJson,
});
// 夜盘报价：Mac 上的 sync/push-overnight-quotes.mjs 定时把 OpenD 的夜盘价推上来。
const overnightQuotes = createOvernightQuoteStore();
// 数据状态：每一样数据跑在哪、最后什么时候更新。只读。
// 服务器上的 OpenD 还没装，所以 configured 先写 false，不会报警。
const SERVER_OPEND = { configured: false, reachable: false, reason: 'not_configured' };
async function handleDataSourcesRoute(url, req, res) {
  if (url.pathname !== '/api/portfolio/data-sources') return false;
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: { code: 'method_not_allowed', message: '数据状态只读' } });
    return true;
  }
  const fileTime = async (path) => {
    try {
      return (await stat(path)).mtime.toISOString();
    } catch {
      return null;
    }
  };
  let workerSeenAt = null;
  try {
    workerSeenAt = (await notificationControl.status())?.workerSeenAt ?? null;
  } catch { /* 读不到就留空 */ }
  sendJson(res, 200, {
    status: buildDataSourceStatus({
      positionsAt: await fileTime(join(PORTFOLIO_POSITIONS_ROOT, 'latest.json')),
      analysisAt: await fileTime(join(PORTFOLIO_ANALYSIS_ROOT, 'latest.json')),
      overnightPushAt: overnightQuotes.updatedAt(),
      overnightActive: classifyMarketSession(new Date(), { hasMinuteSeries: true }) === 'overnight',
      workerSeenAt,
      opend: SERVER_OPEND,
    }),
  });
  return true;
}

const handleOvernightQuotesRoute = createOvernightQuotesRoute({
  store: overnightQuotes,
  token: PORTFOLIO_SYNC_TOKEN,
  sendJson,
  readBody: readPositionsBody,
});

// 三大指数：服务器统一取数并缓存，网页只读缓存，不让每台设备各自去打数据源。
const indexQuotesCache = createIndexQuotesCache({
  fetchQuote: async (symbol) => parseIndexQuote(await getJsonOverIpv4(
    buildYahooChartUrl(symbol),
    { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
    8_000,
  )),
});
const handleIndexQuotesRoute = createIndexQuotesRoute({
  cache: indexQuotesCache,
  sessionOf: () => classifyMarketSession(new Date(), { hasMinuteSeries: true }),
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
async function dispatchAndLogAlert(event, extra = {}, { log = true } = {}) {
  const result = await notificationControl.dispatch(event);
  if (!log) return result;
  try {
    const store = await readAlertLog(PORTFOLIO_ALERTS_ROOT);
    const occurredAt = typeof event?.createdAt === 'string' ? new Date(event.createdAt) : new Date();
    const session = classifyMarketSession(
      Number.isNaN(+occurredAt) ? new Date() : occurredAt, { hasMinuteSeries: true },
    );
    const next = appendAlerts(store, [{
      dedupe_key: `push:${String(event?.dedupeKey || event?.key || '')}`,
      category: alertCategoryForEvent(event),
      symbol: symbolFromEventKey(event),
      icon: '🔔',
      text: `[${sessionLabel(session)}] ${[event?.title, event?.body].filter(Boolean).join(' · ') || '推送'}`,
      pushed: result?.status === 'sent',
      // 没发出去时把原因一起记下来，日志页照实显示，不再一律写「未推送」
      push_state: result?.status === 'sent' ? 'sent' : result?.reason || result?.status || 'not_pushed',
      session,
      occurred_at: typeof event?.createdAt === 'string' ? event.createdAt : undefined,
      ...extra,
    }]);
    if (next !== store) await writeAlertLog(PORTFOLIO_ALERTS_ROOT, next);
  } catch (error) {
    console.warn(`alert log write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return result;
}

// 取某个标的的日线仪表盘：缓存没过期就用缓存，过期就抓一次 Yahoo，
// 抓失败退回上一次成功的数据，绝不返回空白。
async function loadDashboard(symbol) {
  const cacheKey = `dashboard:${symbol}:5y:8`;
  const fresh = readMaSlopeCache(cacheKey, MA_SLOPE_DASHBOARD_CACHE_TTL_MS);
  if (fresh) return fresh;
  try {
    const data = await getJsonOverIpv4(
      buildYahooSlopeChartUrl(symbol, '5y'),
      { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      15_000,
    );
    if (!data?.chart?.result?.[0]) throw new Error('no chart result');
    const result = parseYahooSlopeDashboard(symbol, data, { range: '5y', slopeWindow: 8 });
    writeMaSlopeCache(cacheKey, result);
    return result;
  } catch (error) {
    console.warn(`dashboard load failed: ${symbol} ${error instanceof Error ? error.message : String(error)}`);
    return maSlopeCache.lastGood(cacheKey);
  }
}

// 取某个标的的完整收盘日线。
async function closedDailySeries(symbol) {
  const result = await loadDashboard(symbol);
  return (result?.dashboard?.series || [])
    .filter((point) => point && point.is_partial !== true && Number.isFinite(point.close))
    .map((point) => ({ date: point.date, close: point.close }));
}

// 每天收盘审查之后算一次提醒效果：每条提醒之后第 1 / 5 / 20 个交易日的涨跌，
// 以及同期 QQQ。只读行情，不碰阈值，也不发通知；结果存盘，网页只读。
const ALERT_OUTCOME_SYMBOL_LIMIT = 60;
async function runAlertOutcomesCycle() {
  try {
    const store = await readAlertLog(PORTFOLIO_ALERTS_ROOT);
    const symbols = [...new Set((store.alerts || [])
      .filter((entry) => entry.voided !== true && alertOutcomeKind(entry))
      .map((entry) => outcomeSymbol(entry)))].slice(0, ALERT_OUTCOME_SYMBOL_LIMIT);
    const series = new Map();
    for (const symbol of [...new Set(['QQQ', ...symbols])]) {
      series.set(symbol, await closedDailySeries(symbol));
    }
    const outcomes = computeAlertOutcomes(store, { seriesFor: (symbol) => series.get(symbol) || [] });
    await writeAlertOutcomes(PORTFOLIO_ALERTS_ROOT, {
      version: ALERT_OUTCOMES_VERSION,
      updated_at: new Date().toISOString(),
      outcomes,
      summary: summarizeOutcomes(outcomes),
    });
  } catch (error) {
    console.warn(`alert outcomes failed: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  // Number(null) 是 0：不挡掉就会写出「CNN 0 < 30 · 到达开仓线」这种假话
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
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
    // 盘中已经报过同一档的，收盘这条写成「收盘确认 · 仍在 -5% 档」。
    const liveFiredTiers = new Set((store.alerts || [])
      .map((item) => /^qqq-drawdown-live:(\d+):(.+)$/.exec(String(item.dedupe_key || '')))
      .filter(Boolean)
      .map((match) => `${match[1]}:${match[2]}`));
    const drawdowns = qqqDrawdownEvents(series, { from: oneYearAgo, liveFiredTiers }).map((event) => ({
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
      occurred_at: etCloseInstant(event.date),
    }));
    const withDrawdowns = appendAlerts(store, drawdowns);

    const context = snapshot?.context || {};
    const cnn = alertNumber(context?.cnn_fear_greed?.score);
    const vix = alertNumber(context?.vix?.value);
    const ndxPe = alertNumber(snapshot?.valuation_tab?.ndx?.current_pe);
    const readings = [];
    const readingSession = classifyMarketSession(new Date(), { hasMinuteSeries: true });
    if (cnn !== null) {
      readings.push({
        key: 'cnn', state: cnn < 30 ? 'triggered' : 'normal', category: 'sentiment', symbol: 'CNN',
        icon: cnn < 30 ? '😨' : '🙂', value: cnn, threshold: 30,
        // 和其他实时提醒一样带时段标签
        text: cnnFloorText(cnn, readingSession),
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
    // 券商同步失败也写一条系统提醒；状态翻转才记，不会天天刷屏。
    readings.push(...brokerHealthReadings(snapshot));
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

/**
 * 定时推送写进提醒日志：状态类提醒（可买 / 低估值 / 极低估值）只在刚进入状态
 * 时单独记一行，之后每天还在同一状态就并进一条「汇总」。推送本身不受影响。
 */
async function writeSlotAlertLog({ slot, now, dispatched, events }) {
  if (!dispatched.length) return;
  try {
    const store = await readAlertLog(PORTFOLIO_ALERTS_ROOT);
    const session = classifyMarketSession(now, { hasMinuteSeries: true });
    const plan = planSlotEntries({ store, events: dispatched, present: events, now, slot, session });
    const withStates = { ...store, states: plan.states };
    await writeAlertLog(PORTFOLIO_ALERTS_ROOT, appendAlerts(withStates, plan.entries, now));
  } catch (error) {
    console.warn(`slot alert log write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

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
      const dispatched = [];
      const delivery = await deliverQuantDecisionAlerts({ snapshot, alertsRoot: PORTFOLIO_ALERTS_ROOT, now, notificationSlot: slot,
        notify: async event => {
          // 推送照旧；写不写日志那一行交给降噪模块决定
          const result = await dispatchAndLogAlert({ ...event, scheduleId: schedule.id,
            dedupeKey: `${slot}:${event.key}`, createdAt: now.toISOString() }, {}, { log: false });
          dispatched.push({
            key: event.key,
            title: event.title,
            body: event.body,
            category: alertCategoryForEvent(event),
            symbol: symbolFromEventKey(event),
            icon: '🔔',
            pushed: result?.status === 'sent',
            push_state: result?.status === 'sent' ? 'sent' : result?.reason || result?.status || 'not_pushed',
            occurred_at: now.toISOString(),
          });
          return result.status === 'sent';
        },
      });
      await writeSlotAlertLog({ slot, now, dispatched, events: delivery?.events || [] });
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
      await runAlertOutcomesCycle();
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
  const session = classifyMarketSession(new Date(), { hasMinuteSeries: true });
  const rows = await Promise.all(symbols.map(async (symbol) => {
    try {
      return { symbol, quote: await fetchSessionQuote(symbol, session) };
    } catch (error) {
      return { symbol, reason: error instanceof Error ? error.message : String(error) };
    }
  }));
  sendJson(res, 200, {
    quotes: rows.filter((row) => row.quote).map((row) => row.quote),
    failedSymbols: rows.filter((row) => !row.quote).map((row) => ({ symbol: row.symbol, reason: row.reason })),
    // 日志页顶部状态条要显示「当前时段」和数据时间：时段由服务器判定，
    // 假期表在服务器这一侧，网页不再自己猜。
    session,
    time: new Date().toISOString(),
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
  if (await handleAlertOutcomesRoute(url, req, res)) return;
  if (await handleIndexQuotesRoute(url, req, res)) return;
  if (await handleOvernightQuotesRoute(url, req, res)) return;
  if (await handleDataSourcesRoute(url, req, res)) return;
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
const REALTIME_STATE = { lastTickAt: 0, lastCnn: null, quietQueue: [], wasQuiet: false, running: false, lastQuoteOkAt: null, outageSince: null, dashboardCursor: 0 };
// 一轮只刷这么多个标的的日线，避免把行情源打爆；24 个标的约 6 分钟轮一遍。
const REALTIME_DASHBOARD_PER_TICK = 4;
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
        const quote = await fetchSessionQuote(symbol === 'VIX' ? '^VIX' : symbol, session, now);
        if (quote) {
          quotes[symbol] = quote;
          // 持仓接口要用这份报价重算市值，存一份在内存里。
          // fetchedAt 是「我们什么时候取到的」：休市日拿到的是上一个交易日的
          // 收盘价，行情时间很旧但报价本身是新的，判新鲜度要用取数时间。
          // 过期的价格不进持仓估值，免得拿盘后最后一笔当现价
          if (symbol !== 'VIX' && quote.stale !== true && quote.price !== null) {
            LIVE_QUOTES.set(symbol, { ...quote, fetchedAt: new Date().toISOString() });
          }
        }
      } catch { /* 单个标的取价失败不影响其他 */ }
    }

    // 服务器上的 OpenD 掉线 / 登录失效 / 要验证码时写一条系统提醒。
    try {
      const opendReading = opendReadingForAlerts(SERVER_OPEND);
      if (opendReading) {
        const store = await readAlertLog(PORTFOLIO_ALERTS_ROOT);
        const next = applyStateAlerts(store, [opendReading], now);
        if (next !== store) await writeAlertLog(PORTFOLIO_ALERTS_ROOT, next);
      }
    } catch (error) {
      console.warn(`server opend reading failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 价格拿到了但全都过期（夜盘最典型：停在 19:59）也要报一条，
    // 不然页面会一直拿盘后最后一笔当实时价。
    try {
      const outage = feedOutageReading({ session, quotes, now });
      if (outage) {
        const store = await readAlertLog(PORTFOLIO_ALERTS_ROOT);
        const next = applyStateAlerts(store, [outage], now);
        if (next !== store) await writeAlertLog(PORTFOLIO_ALERTS_ROOT, next);
      }
    } catch (error) {
      console.warn(`overnight feed reading failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 行情源中断超过 10 分钟写一条系统提醒；恢复后再写一条。
    if (Object.keys(quotes).length > 0) {
      const outageMinutes = REALTIME_STATE.outageSince
        ? Math.round((+now - REALTIME_STATE.outageSince) / 60_000)
        : null;
      REALTIME_STATE.lastQuoteOkAt = +now;
      REALTIME_STATE.outageSince = null;
      const reading = feedStateReading({ lastOkAt: REALTIME_STATE.lastQuoteOkAt, now, outageMinutes });
      if (reading) {
        const store = await readAlertLog(PORTFOLIO_ALERTS_ROOT);
        const next = applyStateAlerts(store, [reading], now);
        if (next !== store) await writeAlertLog(PORTFOLIO_ALERTS_ROOT, next);
      }
    } else {
      if (!REALTIME_STATE.outageSince) REALTIME_STATE.outageSince = +now;
      const reading = feedStateReading({ lastOkAt: REALTIME_STATE.lastQuoteOkAt, now });
      if (reading) {
        const store = await readAlertLog(PORTFOLIO_ALERTS_ROOT);
        const next = applyStateAlerts(store, [reading], now);
        if (next !== store) await writeAlertLog(PORTFOLIO_ALERTS_ROOT, next);
      }
    }

    const qqqSeries = await closedDailySeries('QQQ');
    const peak = qqqSeries.reduce((best, point) => (!best || point.close > best.close ? point : best), null);

    // 盘中 Z 用决策页「盘中预览」那一根未收盘日线，只有常规时段才有；
    // 每轮按游标刷几个标的的日线缓存，整个监控范围都能轮到，不再只看前 8 个。
    const zSymbols = symbols.filter((symbol) => symbol !== 'VIX');
    if ((session === 'regular' || session === 'post' || session === 'overnight') && zSymbols.length > 0) {
      for (let step = 0; step < REALTIME_DASHBOARD_PER_TICK; step += 1) {
        await loadDashboard(zSymbols[(REALTIME_STATE.dashboardCursor + step) % zSymbols.length]);
      }
      REALTIME_STATE.dashboardCursor = (REALTIME_STATE.dashboardCursor + REALTIME_DASHBOARD_PER_TICK) % zSymbols.length;
    }
    const intradayZ = {};
    const nearBreakout = {};
    for (const symbol of zSymbols) {
      const dashboard = maSlopeCache.lastGood(`dashboard:${symbol}:5y:8`);
      // 夜盘日线不更新：用新鲜的夜盘价和最后一根完整收盘的均值/标准差估一个 Z
      const live = quotes[symbol];
      const reading = session === 'overnight'
        ? (live && live.stale !== true ? estimatedZFromPrice(dashboard, live.price) : null)
        : intradayZPreview(dashboard);
      if (reading) intradayZ[symbol] = reading;
      // 接近露头：常规时段看未收盘那根，盘后用刚收盘那根确认一次
      if (session === 'regular' || session === 'post') {
        const near = nearBreakoutReading(dashboard, { confirmation: session === 'post' });
        if (near) nearBreakout[symbol] = near;
      } else if (session === 'overnight' && reading) {
        // 夜盘用估算出来的 Z 判断接近露头，连续天数仍按完整收盘数
        const near = nearBreakoutReading(dashboard, { confirmation: false });
        if (near) nearBreakout[symbol] = { ...near, currentZ: reading.currentZ, price: reading.price };
      }
    }

    const sellLines = {};
    for (const [symbol, family] of Object.entries(snapshot?.sell?.symbols || {})) {
      // 先过一遍合理性校验：离谱的卖出线（低于现价一半或高于三倍）不参与比价，
      // 否则 TSLA 那种 $30.98 的坏数据会天天报「已到卖出线」。
      const raw = family?.sell_price_plan || {};
      const reference = sellPriceReference(raw) ?? alertNumber(quotes[symbol]?.price);
      const plan = saneSellPricePlan(raw, reference);
      const trigger = alertNumber(plan?.trigger_price ?? plan?.sell_price);
      if (String(plan?.method || '') !== 'unavailable' && trigger !== null && trigger > 0) {
        // 基准价一起传过去：判定那一侧再按卖出页的同一规则校验一次，无效的直接跳过。
        sellLines[symbol] = { trigger, reference, label: plan.action_stage_key === 'trim_stock' ? '正股分批' : '开始降风险' };
      }
    }

    // 三大指数/期货的当前读数（服务器缓存里取，不额外打上游）
    let indexItems = [];
    try {
      indexItems = (await indexQuotesCache.read(session)).items;
    } catch (error) {
      console.warn(`index quotes for alerts failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    // 持仓今日预估盈亏：用刚取到的报价和券商持仓算
    const portfolioLoss = portfolioDayLoss({
      positions,
      quotes,
      nav: alertNumber(snapshot?.ammo_overview?.nav_usd),
    });

    const cnnScore = alertNumber(snapshot?.context?.cnn_fear_greed?.score);
    const store = await readAlertLog(PORTFOLIO_ALERTS_ROOT);
    // 刚重启时没有「上一次的 CNN」：从日志里取最近一次已知值当起点，
    // 取不到就这一轮不做比较，绝不拿 0 当起点。
    if (REALTIME_STATE.lastCnn === null) REALTIME_STATE.lastCnn = lastKnownCnnScore(store);
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
      cnnScore,
      previousCnnScore: REALTIME_STATE.lastCnn,
      // 「跌破 30」和原有的「到达开仓线」算同一个事件，不重复记一行
      cnnFloorReported: store.states?.cnn === 'triggered',
      settings: realtime,
      quiet,
      dispatch: (event) => notificationControl.dispatch(event),
      cooldownMs: NOISE_CONFIG.cooldownMinutes * 60_000,
      bigMove: NOISE_CONFIG.bigMove,
      nearBreakout,
      indexItems,
      portfolioLoss,
    });
    if (cnnScore !== null) REALTIME_STATE.lastCnn = cnnScore;
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

// 推送失败重试：每分钟看一眼有没有到点要重发的，结果回填到提醒日志那一行。
const PUSH_RETRY_TICK_MS = 60 * 1000;
let pushRetryRunning = false;
async function runPushRetryCycle() {
  if (pushRetryRunning) return;
  pushRetryRunning = true;
  try {
    const resolved = await notificationControl.retryPending();
    if (resolved.length === 0) return;
    const store = await readAlertLog(PORTFOLIO_ALERTS_ROOT);
    let next = store;
    for (const item of resolved) {
      if (!item?.dedupeKey) continue;
      next = setPushState(next, item.dedupeKey, item.status === 'suppressed' ? item.reason || 'suppressed' : item.status);
    }
    if (next !== store) await writeAlertLog(PORTFOLIO_ALERTS_ROOT, next);
  } catch (error) {
    console.warn(`push retry failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    pushRetryRunning = false;
  }
}

const realtimeMonitorTimer = setInterval(runRealtimeMonitorCycle, REALTIME_TICK_MS);
const pushRetryTimer = setInterval(runPushRetryCycle, PUSH_RETRY_TICK_MS);
const quantDecisionTimer = setInterval(runStoredQuantDecisionCycle, QUANT_DECISION_INTERVAL_MS);
const channelReviewTimer = setInterval(runStoredChannelReviewCycle, CHANNEL_REVIEW_INTERVAL_MS);
void runStoredQuantDecisionCycle();
void runStoredChannelReviewCycle();
// 旧账：零碎持仓被当成交易记过的那几条，启动时标成「已作废」并写明原因，不删除。
void voidDustRecords(PORTFOLIO_ALERTS_ROOT)
  .then((summary) => {
    if (summary.trades || summary.alerts) {
      console.warn(`voided dust records: ${summary.trades} trades, ${summary.alerts} alerts`);
    }
  })
  .catch((error) => console.warn(`void dust records failed: ${error instanceof Error ? error.message : String(error)}`));
// 旧账三：成交时间落在非交易日的（同步时间当成了成交时间），挪到上一个交易日
// 的收盘并标明「按对账日推定」，原时间留在 trade_time_original 里。
async function runTradeDateRepairCycle() {
  try {
    const store = await readDecisionLog(PORTFOLIO_ALERTS_ROOT);
    const next = repairTradeDates(store);
    if (next !== store) {
      await writeDecisionLog(PORTFOLIO_ALERTS_ROOT, next);
      const fixed = next.trades.filter((trade) => trade.trade_time_original).length;
      console.warn(`trade date repair: ${fixed} trades moved to the reconciled trading day`);
    }
  } catch (error) {
    console.warn(`trade date repair failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 旧账二：非常规时段「较昨收」参考价用错，按真实日线收盘价重算一次。
// 实际没到阈值的标作废，仍超过阈值的改正数字并保留原文。跑第二遍什么都不改。
async function runReferencePriceFixCycle() {
  try {
    const store = await readAlertLog(PORTFOLIO_ALERTS_ROOT);
    // 只有「按真实收盘价重算」这一类要行情；Z 措辞和按新阈值作废不需要，
    // 所以取不到标的也要继续往下跑。
    const symbols = [...new Set((store.alerts || [])
      .filter((item) => item.voided !== true && item.corrected !== true
        && item.session && item.session !== 'regular'
        && String(item.dedupe_key || '').startsWith('big-move:'))
      .map((item) => String(item.symbol || '').toUpperCase())
      .filter(Boolean))];
    const series = new Map();
    for (const symbol of symbols) series.set(symbol, await closedDailySeries(symbol));
    const next = applyReferencePriceFixes(store, { seriesFor: (symbol) => series.get(symbol) || [] });
    if (next !== store) {
      await writeAlertLog(PORTFOLIO_ALERTS_ROOT, next);
      const counts = (reason) => next.alerts.filter((item) => item.voided_reason === reason).length;
      console.warn(
        `alert log fixes: ${counts('参考价错误')} voided by reference price, `
        + `${counts('按新阈值不再提醒')} voided by new thresholds, `
        + `${next.alerts.filter((item) => item.corrected === true).length} corrected`,
      );
    }
  } catch (error) {
    console.warn(`reference price fix failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// 提醒效果平时跟着每天的收盘审查算；刚上线这一次先补算一份，免得分页空着等一天。
// 延后一分钟再跑，不和启动时的其他任务抢行情接口。
setTimeout(async () => {
  // 先把参考价算错的旧条目处理掉，再算效果统计，免得统计里混进作废的
  await runReferencePriceFixCycle();
  await runTradeDateRepairCycle();
  await runAlertOutcomesCycle();
}, 60_000).unref?.();
server.on('close', () => {
  clearInterval(realtimeMonitorTimer);
  clearInterval(pushRetryTimer);
  clearInterval(quantDecisionTimer);
  clearInterval(channelReviewTimer);
});
