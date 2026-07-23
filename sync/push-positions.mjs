import { execFile } from 'node:child_process';
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFirstJsonObject } from './extractJson.mjs';

const DEFAULT_CLI = join(homedir(), 'Projects/futu-assistant/.venv/bin/futu-assistant');
const DEFAULT_SITE_EXPORT = join(homedir(), 'Projects/futu-assistant/data/site_export.json');
const DEFAULT_ORIGIN = 'http://67.215.255.196:8788';
const DEFAULT_TOKEN_FILE = join(homedir(), '.portfolio-sync-token');
const DEFAULT_LOG_FILE = join(homedir(), 'Library/Logs/portfolio-sync.log');

function runPositionsStatus(cliPath) {
  return new Promise((resolve, reject) => {
    execFile(cliPath, ['positions-status'], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`positions-status 失败：${error.message}${stderr ? `；${String(stderr).trim().slice(0, 200)}` : ''}`));
        return;
      }
      resolve(String(stdout));
    });
  });
}

function runSiteExport(cliPath) {
  return new Promise((resolve, reject) => {
    execFile(cliPath, ['site-export'], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`site-export 失败：${error.message}${stderr ? `；${String(stderr).trim().slice(0, 200)}` : ''}`));
        return;
      }
      resolve(String(stdout));
    });
  });
}

function runRefreshNow(cliPath) {
  return new Promise((resolve, reject) => {
    execFile(cliPath, ['refresh-now'], { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`refresh-now 失败：${error.message}${stderr ? `；${String(stderr).trim().slice(0, 200)}` : ''}`));
        return;
      }
      try {
        const payload = extractFirstJsonObject(String(stdout));
        if (payload?.ok !== true) throw new Error(payload?.error || '返回 ok=false');
        resolve(payload);
      } catch (parseError) {
        reject(new Error(`refresh-now 返回无效：${parseError instanceof Error ? parseError.message : String(parseError)}`));
      }
    });
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

async function postSnapshot(origin, token, pathname, snapshot) {
  const response = await fetch(`${origin.replace(/\/+$/, '')}${pathname}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  });
  if (!response.ok) {
    const message = (await response.text()).slice(0, 300);
    throw new Error(`网关返回 HTTP ${response.status}${message ? `：${message}` : ''}`);
  }
}

async function pushAnalysis(cliPath, origin, token) {
  const exportPath = process.env.FUTU_ASSISTANT_SITE_EXPORT || DEFAULT_SITE_EXPORT;
  await runSiteExport(cliPath);
  const snapshot = JSON.parse(await readFile(exportPath, 'utf8'));
  const symbolsValid = snapshot?.symbols && typeof snapshot.symbols === 'object' && !Array.isArray(snapshot.symbols);
  if (snapshot?.source !== 'futu-assistant' || !symbolsValid || Number.isNaN(Date.parse(snapshot?.generated_at))) {
    throw new Error('site-export 返回结构不符合量化分析数据契约');
  }
  await postSnapshot(origin, token, '/api/portfolio/quant-analysis', snapshot);
  return Object.keys(snapshot.symbols).length;
}

async function appendSyncLog(status, count, message = '') {
  const logPath = process.env.PORTFOLIO_SYNC_LOG || DEFAULT_LOG_FILE;
  await mkdir(dirname(logPath), { recursive: true });
  const suffix = message ? ` message=${JSON.stringify(message)}` : '';
  await appendFile(logPath, `${new Date().toISOString()} status=${status} positions=${count}${suffix}\n`, 'utf8');
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createRefreshRequestProcessor({
  readRequest,
  refreshNow,
  pushSnapshots,
  completeRequest,
}) {
  let running = false;
  return {
    async pollOnce() {
      if (running) return { status: 'ignored', reason: 'running' };
      const request = await readRequest();
      if (request?.status !== 'pending') return { status: 'idle' };
      running = true;
      try {
        const refresh = await refreshNow();
        const snapshots = await pushSnapshots();
        const result = { ok: true, refresh, snapshots };
        await completeRequest(result);
        return { status: 'done', result };
      } catch (error) {
        const result = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
        try {
          await completeRequest(result);
        } catch {
          // The next poll retries naturally; watch mode must stay alive.
        }
        return { status: 'done', result };
      } finally {
        running = false;
      }
    },
  };
}

async function getRefreshRequest(origin, token) {
  const response = await fetch(`${origin.replace(/\/+$/, '')}/api/refresh-request`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`读取刷新请求失败：HTTP ${response.status}`);
  return response.json();
}

async function completeRefreshRequest(origin, token, result) {
  const response = await fetch(`${origin.replace(/\/+$/, '')}/api/refresh-request/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ result }),
  });
  if (!response.ok) throw new Error(`上报刷新结果失败：HTTP ${response.status}`);
}

export async function createDefaultRefreshRequestProcessor() {
  const cliPath = process.env.FUTU_ASSISTANT_CLI || DEFAULT_CLI;
  const origin = process.env.PORTFOLIO_GATEWAY_ORIGIN || DEFAULT_ORIGIN;
  const token = await readSyncToken();
  return createRefreshRequestProcessor({
    readRequest: () => getRefreshRequest(origin, token),
    refreshNow: () => runRefreshNow(cliPath),
    pushSnapshots: async () => {
      const result = await pushPositions();
      if (!result.analysisPushed) throw new Error('量化分析快照上传失败');
      return result;
    },
    completeRequest: (result) => completeRefreshRequest(origin, token, result),
  });
}

export async function watchRefreshRequests({
  processor,
  sleep = wait,
  pollMilliseconds = 60_000,
} = {}) {
  const activeProcessor = processor || await createDefaultRefreshRequestProcessor();
  while (true) {
    try {
      await activeProcessor.pollOnce();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await appendSyncLog('watch_failure', 0, message);
      } catch {
        // Logging must not terminate the long-running watch process.
      }
    }
    await sleep(pollMilliseconds);
  }
}

export async function pushPositions() {
  const cliPath = process.env.FUTU_ASSISTANT_CLI || DEFAULT_CLI;
  const origin = process.env.PORTFOLIO_GATEWAY_ORIGIN || DEFAULT_ORIGIN;
  let count = 0;
  try {
    const stdout = await runPositionsStatus(cliPath);
    const payload = extractFirstJsonObject(stdout);
    if (!Array.isArray(payload?.positions) || typeof payload?.net_liquidation !== 'number') {
      throw new Error('positions-status 返回结构不符合持仓数据契约');
    }
    count = payload.positions.length;
    const token = await readSyncToken();
    const snapshot = { payload, pushed_at: new Date().toISOString(), source: 'futu-assistant' };
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await postSnapshot(origin, token, '/api/portfolio/positions', snapshot);
        await appendSyncLog('success', count);
        let analysisPushed = false;
        try {
          const symbolCount = await pushAnalysis(cliPath, origin, token);
          analysisPushed = true;
          await appendSyncLog('analysis_success', symbolCount);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          try {
            await appendSyncLog('analysis_failure', 0, message);
          } catch {
            // A secondary log failure must not undo a successful holdings push.
          }
        }
        return { count, pushedAt: snapshot.pushed_at, analysisPushed };
      } catch (error) {
        lastError = error;
        if (attempt === 0) await wait(30_000);
      }
    }
    throw lastError;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendSyncLog('failure', count, message);
    throw error;
  }
}

const executedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (executedPath) {
  const command = process.argv.includes('--watch') ? watchRefreshRequests() : pushPositions();
  command
    .then(({ count, pushedAt }) => console.log(`portfolio sync ok positions=${count} pushed_at=${pushedAt}`))
    .catch((error) => {
      console.error(`portfolio sync failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
