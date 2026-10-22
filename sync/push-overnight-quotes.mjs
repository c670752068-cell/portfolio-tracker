#!/usr/bin/env node
// 夜盘（美东 20:00–04:00）把富途 OpenD 的美股报价推给网站网关。
// 免费行情源在这个时段是停的（Yahoo 的价格一直停在 19:59），OpenD 有夜盘价，
// 但它只在这台 Mac 的 127.0.0.1:11111 上监听，网关在美国 VPS 上连不到，
// 所以这里定时取一次再推上去。不碰任何下单接口，只读行情。
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_ORIGIN = 'https://myopenid.top';
const DEFAULT_TOKEN_FILE = join(homedir(), '.portfolio-sync-token');
const DEFAULT_PYTHON = '/Users/wuhuazhou/Projects/futu-assistant/.venv/bin/python';
const OPEND_HOST = process.env.FUTU_OPEND_HOST || '127.0.0.1';
const OPEND_PORT = Number(process.env.FUTU_OPEND_PORT || 11111);
// 指数 ETF 固定推，其余跟着持仓和观察标的走
const CORE_SYMBOLS = ['QQQ', 'QQQM', 'TQQQ', 'SOXL', 'TSLL'];
const SYMBOL_LIMIT = 40;

/** 只在夜盘推：美东 20:00 到次日 04:00。 */
export function shouldPushNow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour);
  return hour >= 20 || hour < 4;
}

export function overnightSymbols({ held = [], watch = [] } = {}) {
  const clean = (list) => list
    .map((item) => String(item || '').trim().toUpperCase().replace(/^US\./, ''))
    .filter(Boolean);
  return [...new Set([...CORE_SYMBOLS, ...clean(held), ...clean(watch)])].slice(0, SYMBOL_LIMIT);
}

/** OpenD 的 update_time 是美东本地时间，补上时区再转成 ISO。 */
function easternToIso(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(String(value || ''));
  if (!match) return null;
  const [, year, month, day, hour, minute, second, ms] = match;
  // 美东相对 UTC 的偏移（夏令时 -4，冬令时 -5）由 Intl 算出来，不写死
  const guess = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second, Number(ms || 0));
  const offsetName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', timeZoneName: 'shortOffset',
  }).formatToParts(new Date(guess)).find((part) => part.type === 'timeZoneName')?.value || 'GMT-5';
  const offsetHours = Number(/GMT([+-]\d+)/.exec(offsetName)?.[1] || -5);
  return new Date(guess - offsetHours * 3_600_000).toISOString();
}

export function parseOpendOutput(raw) {
  let value;
  try {
    value = JSON.parse(String(raw || ''));
  } catch {
    return [];
  }
  const rows = Array.isArray(value?.quotes) ? value.quotes : [];
  return rows.flatMap((row) => {
    const symbol = String(row?.code || '').trim().toUpperCase().replace(/^US\./, '');
    const price = Number(row?.last_price);
    const priceTime = easternToIso(row?.update_time);
    if (!symbol || !Number.isFinite(price) || price <= 0 || !priceTime) return [];
    return [{
      symbol,
      price,
      previousClose: Number.isFinite(Number(row?.prev_close_price)) ? Number(row.prev_close_price) : null,
      priceTime,
    }];
  });
}

async function readSyncToken() {
  const environmentValue = process.env.PORTFOLIO_SYNC_TOKEN?.trim();
  if (environmentValue) return environmentValue;
  const tokenPath = process.env.PORTFOLIO_SYNC_TOKEN_FILE || DEFAULT_TOKEN_FILE;
  const info = await stat(tokenPath);
  if ((info.mode & 0o077) !== 0) throw new Error(`${tokenPath} 权限必须为 600`);
  const token = (await readFile(tokenPath, 'utf8')).trim();
  if (!token) throw new Error('同步认证文件为空');
  return token;
}

function readOpend(symbols) {
  const python = process.env.FUTU_PYTHON || DEFAULT_PYTHON;
  const script = `
import json, sys
from futu import OpenQuoteContext, RET_OK
codes = [c if c.startswith('US.') else 'US.' + c for c in sys.argv[1].split(',')]
ctx = OpenQuoteContext(host=${JSON.stringify(OPEND_HOST)}, port=${OPEND_PORT})
try:
    ret, data = ctx.get_market_snapshot(codes)
    if ret != RET_OK:
        print(json.dumps({"quotes": [], "error": str(data)[:200]}))
    else:
        cols = [c for c in ("code", "last_price", "prev_close_price", "update_time") if c in data.columns]
        print(json.dumps({"quotes": data[cols].to_dict("records")}, default=str))
finally:
    ctx.close()
`;
  return new Promise((resolve, reject) => {
    execFile(python, ['-c', script, symbols.join(',')], { timeout: 60_000 }, (error, stdout) => {
      if (error && !stdout) {
        reject(new Error(`读取 OpenD 失败：${error.message.slice(0, 200)}`));
        return;
      }
      // SDK 会往 stdout 打日志，取最后一行 JSON
      const line = String(stdout).trim().split('\n').filter((item) => item.trim().startsWith('{')).at(-1) || '';
      resolve(line);
    });
  });
}

async function main() {
  const now = new Date();
  if (!shouldPushNow(now) && process.env.FORCE_OVERNIGHT_PUSH !== '1') {
    console.log(`[overnight] 现在不是夜盘，跳过（${now.toISOString()}）`);
    return;
  }
  const origin = process.env.PORTFOLIO_SYNC_ORIGIN || DEFAULT_ORIGIN;
  const token = await readSyncToken();
  // 持仓和观察标的从网关的只读接口拿，省得这边再维护一份名单
  const held = (process.env.OVERNIGHT_EXTRA_SYMBOLS || '').split(',').filter(Boolean);
  const watch = [];
  try {
    const response = await fetch(`${origin.replace(/\/+$/, '')}/api/portfolio/positions`);
    if (response.ok) {
      const payload = (await response.json())?.payload;
      for (const item of payload?.positions || []) {
        if (item?.asset_type === 'option') continue;
        watch.push(String(item?.symbol || ''));
      }
    }
  } catch {
    // 拿不到就只推核心几个，不影响这一轮
  }
  const symbols = overnightSymbols({ held, watch });
  const quotes = parseOpendOutput(await readOpend(symbols));
  if (quotes.length === 0) {
    console.warn('[overnight] OpenD 没有返回有效报价，这一轮不推送');
    return;
  }
  const response = await fetch(`${origin.replace(/\/+$/, '')}/api/portfolio/overnight-quotes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'futu_opend', quotes }),
  });
  if (!response.ok) {
    throw new Error(`网关返回 HTTP ${response.status}：${(await response.text()).slice(0, 200)}`);
  }
  console.log(`[overnight] 已推送 ${quotes.length} 条（${quotes[0].symbol} ${quotes[0].price}）`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[overnight] 推送失败：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
