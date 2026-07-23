import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const REFRESH_REQUEST_PATH = '/api/refresh-request';
const COMPLETE_PATH = '/api/refresh-request/complete';
const THROTTLE_MS = 60_000;
const MAX_COMPLETE_BYTES = 1024 * 1024;

async function readState(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return { status: 'idle' };
  }
}

async function writeState(filePath, state) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(state), { mode: 0o600 });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function readCompletion(req) {
  const parts = [];
  let total = 0;
  for await (const part of req) {
    total += part.length;
    if (total > MAX_COMPLETE_BYTES) throw new Error('请求体过大');
    parts.push(part);
  }
  const payload = JSON.parse(Buffer.concat(parts).toString('utf8'));
  if (!payload || typeof payload !== 'object' || !('result' in payload)) {
    throw new Error('result 缺失');
  }
  return payload.result;
}

export function createRefreshRequestRoute({
  token,
  filePath,
  sendJson,
  now = () => new Date(),
}) {
  return async function handleRefreshRequestRoute(url, req, res) {
    if (url.pathname !== REFRESH_REQUEST_PATH && url.pathname !== COMPLETE_PATH) {
      return false;
    }
    if (!token) {
      sendJson(res, 404, { error: { code: 'not_found', message: '未知接口' } });
      return true;
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      sendJson(res, 401, { error: { code: 'unauthorized', message: '认证失败' } });
      return true;
    }
    if (url.pathname === REFRESH_REQUEST_PATH && req.method === 'GET') {
      sendJson(res, 200, await readState(filePath));
      return true;
    }
    if (url.pathname === REFRESH_REQUEST_PATH && req.method === 'POST') {
      const current = await readState(filePath);
      const currentTime = now();
      const requestedAt = Date.parse(current?.requested_at || '');
      if (
        current?.status === 'pending'
        && Number.isFinite(requestedAt)
        && currentTime.getTime() - requestedAt < THROTTLE_MS
      ) {
        sendJson(res, 202, {
          throttled: true,
          requested_at: current.requested_at,
        });
        return true;
      }
      const state = {
        status: 'pending',
        requested_at: currentTime.toISOString(),
      };
      await writeState(filePath, state);
      sendJson(res, 200, { ok: true, requested_at: state.requested_at });
      return true;
    }
    if (url.pathname === COMPLETE_PATH && req.method === 'POST') {
      try {
        const state = {
          status: 'done',
          completed_at: now().toISOString(),
          result: await readCompletion(req),
        };
        await writeState(filePath, state);
        sendJson(res, 200, { ok: true, completed_at: state.completed_at });
      } catch (error) {
        sendJson(res, 400, {
          error: {
            code: 'invalid_completion',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
      return true;
    }
    sendJson(res, 404, { error: { code: 'not_found', message: '未知接口' } });
    return true;
  };
}
