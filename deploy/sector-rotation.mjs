import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { etParts, knownTradingDate } from './market-session.mjs';

export const SECTOR_SYMBOLS = ['XLK', 'XLC', 'XLE', 'XLY', 'XLF', 'XLI', 'XLP', 'XLV', 'XLB', 'XLU', 'XLRE'];
const TTL = 15 * 60_000;
const RETRY_MS = 60_000;
const MAX_SYMBOLS = 12;

function previousDate(date) {
  return new Date(Date.parse(`${date}T12:00:00Z`) - 86400_000).toISOString().slice(0, 10);
}

export function rotationCalendar(now = new Date()) {
  const et = etParts(now);
  // Allow 20 minutes for the closing bar to settle, including half days.
  const earlyClose = ['2026-11-27', '2026-12-24'].includes(et.date);
  let expected = et.minutes >= (earlyClose ? 13 : 16) * 60 + 20 ? et.date : previousDate(et.date);
  while (knownTradingDate(expected) === false) expected = previousDate(expected);
  let friday = new Date(`${et.date}T12:00:00Z`);
  friday.setUTCDate(friday.getUTCDate() + ((5 - friday.getUTCDay() + 7) % 7));
  const fridayKey = friday.toISOString().slice(0, 10);
  let lastSession = fridayKey;
  while (knownTradingDate(lastSession) === false) lastSession = previousDate(lastSession);
  if (expected < lastSession) friday.setUTCDate(friday.getUTCDate() - 7);
  return { expected_close: expected, completed_week: friday.toISOString().slice(0, 10), calendar_verified: et.year === 2026 };
}

export function parseRotationHistory(symbol, payload, now = new Date()) {
  const result = payload?.chart?.result?.[0];
  const adjusted = result?.indicators?.adjclose?.[0]?.adjclose;
  if (!result || !Array.isArray(adjusted) || result.meta?.currency !== 'USD') throw new Error('缺少美元复权收盘数据');
  const canonical = value => String(value ?? '').toUpperCase().replaceAll('.', '-');
  if (canonical(result.meta.symbol) !== canonical(symbol)) throw new Error('行情代码不匹配');
  const { expected_close } = rotationCalendar(now);
  const points = new Map();
  for (let i = 0; i < (result.timestamp?.length ?? 0); i++) {
    const value = adjusted[i];
    const timestamp = result.timestamp[i];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || !Number.isFinite(timestamp)) continue;
    const date = etParts(new Date(timestamp * 1000)).date;
    if (date > expected_close) continue; // Never include an unfinished regular-session bar.
    points.set(date, { date, close: value });
  }
  const series = [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (series.length < 2) throw new Error('完整收盘历史不足');
  return { symbol, series, as_of: series.at(-1).date, fetched_at: now.toISOString(), source: 'Yahoo Finance adjusted close', adjustment: 'split_and_dividend_adjusted', currency: 'USD' };
}

/** Isolated public-market-data route. No portfolio writes, notifications, or trading. */
export function createSectorRotationRoute({ fetchJson, sendJson, cacheRoot, clock = () => new Date() }) {
  const memory = new Map();
  const inFlight = new Map();
  const rates = new Map();
  const pending = [];
  let running = 0;
  const limited = task => new Promise((resolve, reject) => {
    pending.push({ task, resolve, reject });
    pump();
  });
  function pump() {
    while (running < 3 && pending.length) {
      const job = pending.shift();
      running++;
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => { running--; pump(); });
    }
  }
  async function load(symbol) {
    const now = clock();
    const previous = memory.get(symbol);
    if (previous && +now - previous.checkedAt < (previous.failed ? RETRY_MS : TTL)) return previous;
    if (inFlight.has(symbol)) return inFlight.get(symbol);
    const promise = limited(async () => {
      let cached = previous?.data;
      if (!cached && cacheRoot) {
        try {
          const saved = JSON.parse(await readFile(join(cacheRoot, `${symbol}.json`), 'utf8'));
          if (saved.symbol === symbol && saved.adjustment === 'split_and_dividend_adjusted' && Array.isArray(saved.series)) cached = saved;
        } catch { /* Cache is optional and never a reason to invent a price. */ }
      }
      let data = cached;
      let failed = false;
      let error = null;
      if (!cached || +now - Date.parse(cached.fetched_at) >= TTL || !Number.isFinite(Date.parse(cached.fetched_at))) {
        try {
          const ticker = encodeURIComponent(symbol.replaceAll('.', '-'));
          const payload = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=2y&interval=1d&includeAdjustedClose=true`, { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }, 12_000);
          data = parseRotationHistory(symbol, payload, clock());
          if (cacheRoot) {
            try {
              await mkdir(cacheRoot, { recursive: true });
              const target = join(cacheRoot, `${symbol}.json`);
              await writeFile(`${target}.tmp`, JSON.stringify(data), { mode: 0o600 });
              await rename(`${target}.tmp`, target);
            } catch { /* A failed disk cache must not hide a successful upstream result. */ }
          }
        } catch {
          failed = true;
          error = cached ? '刷新失败，展示上次成功数据' : '复权行情暂不可用，请稍后重试';
        }
      }
      const entry = { data: data ?? null, failed, error, checkedAt: +clock() };
      if (memory.size >= 128 && !memory.has(symbol)) memory.delete(memory.keys().next().value);
      memory.set(symbol, entry);
      return entry;
    }).finally(() => inFlight.delete(symbol));
    inFlight.set(symbol, promise);
    return promise;
  }
  return async function route(url, req, res) {
    if (url.pathname !== '/api/portfolio/sector-rotation') return false;
    if (req.method !== 'GET') { sendJson(res, 405, { error: { message: '仅支持读取' } }); return true; }
    const requested = url.searchParams.get('symbols');
    const symbols = requested == null ? ['SPY', ...SECTOR_SYMBOLS] : [...new Set(requested.split(',').map(s => s.trim().toUpperCase()))];
    if (!symbols.length || symbols.length > MAX_SYMBOLS || symbols.some(s => !/^[A-Z][A-Z0-9.\-]{0,10}$/.test(s))) {
      sendJson(res, 400, { error: { message: '每次最多查询 12 个有效美股代码' } }); return true;
    }
    const key = req.socket?.remoteAddress ?? 'unknown';
    const now = +clock();
    const rate = rates.get(key);
    if (rates.size > 512) for (const [ip, entry] of rates) if (now - entry.since > 60_000) rates.delete(ip);
    if (!rate || now - rate.since > 60_000) rates.set(key, { since: now, count: 1 });
    else if (++rate.count > 30) { sendJson(res, 429, { error: { message: '请求较多，请一分钟后重试' } }); return true; }
    // Bound all outstanding upstream work, not just work from a single client.
    if (pending.length + running > 60) { sendJson(res, 503, { error: { message: '行情服务繁忙，请稍后重试' } }); return true; }
    const entries = await Promise.all(symbols.map(load));
    const calendar = rotationCalendar(clock());
    sendJson(res, 200, {
      version: 1, generated_at: clock().toISOString(), ...calendar, benchmark: 'SPY',
      price_basis: 'split_and_dividend_adjusted',
      series: Object.fromEntries(symbols.map((symbol, i) => {
        const entry = entries[i];
        return [symbol, { ...entry.data, symbol, available: Boolean(entry.data), stale: entry.failed || !entry.data || entry.data.as_of < calendar.expected_close, error: entry.error }];
      })),
    });
    return true;
  };
}
