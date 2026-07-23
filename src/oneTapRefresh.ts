export const ONE_TAP_REFRESH_COOLDOWN_MS = 60_000;
export const ONE_TAP_REFRESH_POLL_MS = 5_000;
export const ONE_TAP_REFRESH_TIMEOUT_MS = 180_000;

export type OneTapRefreshPhase =
  | 'idle'
  | 'requested'
  | 'throttled'
  | 'waiting'
  | 'done'
  | 'timeout'
  | 'error';

export interface OneTapRefreshState {
  phase: OneTapRefreshPhase;
  message: string;
  completedAt?: string;
}

export type RefreshRequestResponse =
  | { ok: true; requested_at: string }
  | { throttled: true; requested_at: string };

export interface RefreshRequestStatus {
  status: 'idle' | 'pending' | 'done';
  requested_at?: string;
  completed_at?: string;
  result?: {
    ok?: boolean;
    error?: string;
    [key: string]: unknown;
  };
}

interface OneTapRefreshDependencies {
  request: () => Promise<RefreshRequestResponse>;
  refreshExisting: () => Promise<void>;
  read: () => Promise<RefreshRequestStatus>;
  onState: (state: OneTapRefreshState) => void;
  wait?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

export function oneTapRefreshCooldownSeconds(now: number, requestedAt: number): number {
  return Math.max(0, Math.ceil((requestedAt + ONE_TAP_REFRESH_COOLDOWN_MS - now) / 1000));
}

export async function runOneTapRefresh({
  request,
  refreshExisting,
  read,
  onState,
  wait = sleep,
  pollIntervalMs = ONE_TAP_REFRESH_POLL_MS,
  timeoutMs = ONE_TAP_REFRESH_TIMEOUT_MS,
}: OneTapRefreshDependencies): Promise<void> {
  try {
    const response = await request();
    onState('throttled' in response && response.throttled
      ? { phase: 'throttled', message: '刚刚已有刷新请求，正在处理中' }
      : { phase: 'requested', message: '已请求量化重算…' });

    await refreshExisting();
    onState({ phase: 'waiting', message: '正在计算（约 1 分钟）…' });

    const maxPolls = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      await wait(pollIntervalMs);
      const status = await read();
      if (status.status !== 'done') continue;
      if (status.result?.ok === false) {
        onState({
          phase: 'error',
          message: `量化重算失败：${status.result.error || '未知错误'}；已显示现有最新数据`,
        });
        return;
      }
      await refreshExisting();
      onState({
        phase: 'done',
        message: '已更新',
        completedAt: status.completed_at || new Date().toISOString(),
      });
      return;
    }

    onState({
      phase: 'timeout',
      message: '量化系统未在 3 分钟内响应，可能 Mac 端未运行；已显示现有最新数据',
    });
  } catch (error) {
    await refreshExisting().catch(() => undefined);
    onState({
      phase: 'error',
      message: `一键刷新失败：${error instanceof Error ? error.message : String(error)}；已显示现有最新数据`,
    });
  }
}

function authorizationHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token.trim()}`,
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw new Error(`刷新接口返回格式无效（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    const error = 'error' in body && body.error && typeof body.error === 'object'
      ? (body.error as { message?: unknown }).message
      : undefined;
    throw new Error(typeof error === 'string' ? error : `刷新接口失败（HTTP ${response.status}）`);
  }
  return body as Record<string, unknown>;
}

export async function requestOneTapRefresh(url: string, token: string): Promise<RefreshRequestResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: authorizationHeaders(token),
  });
  const body = await readJson(response);
  if (body.throttled === true && typeof body.requested_at === 'string') {
    return { throttled: true, requested_at: body.requested_at };
  }
  if (body.ok === true && typeof body.requested_at === 'string') {
    return { ok: true, requested_at: body.requested_at };
  }
  throw new Error('刷新请求返回格式无效');
}

export async function readOneTapRefresh(url: string, token: string): Promise<RefreshRequestStatus> {
  const response = await fetch(url, {
    headers: authorizationHeaders(token),
  });
  const body = await readJson(response);
  if (body.status !== 'idle' && body.status !== 'pending' && body.status !== 'done') {
    throw new Error('刷新状态返回格式无效');
  }
  return body as unknown as RefreshRequestStatus;
}
