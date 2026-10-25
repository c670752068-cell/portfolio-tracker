// 服务器侧的定时推送 worker。
// Mac 上那份（futu-assistant 的 push/notification_control.py）仍然是主力；
// 这一份默认整个关着，而且就算打开也默认只写日志不推手机，避免两边重复推送。
// 只有 Mac 那份停够久了才接管，接管后也只做「服务器自己能算」的那部分：
// 系统运行报告——哪几样数据停了、哪几样照常。
export const DEFAULT_SERVER_WORKER_CONFIG = Object.freeze({
  enabled: false,
  push: false,
  takeoverAfterMinutes: 90,
});
export const SERVER_WORKER_CONFIG_FILE = 'server-worker.config.json';

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

export function loadServerWorkerConfig(raw) {
  const value = record(raw);
  const minutes = Number(value.takeoverAfterMinutes);
  return {
    enabled: value.enabled === true,
    push: value.push === true,
    takeoverAfterMinutes: Number.isFinite(minutes) && minutes > 0
      ? minutes
      : DEFAULT_SERVER_WORKER_CONFIG.takeoverAfterMinutes,
  };
}

export function shouldServerWorkerAct({ config, workerSeenAt, now = new Date() }) {
  if (!config?.enabled) return { act: false, reason: 'disabled' };
  const seen = Date.parse(String(workerSeenAt || ''));
  if (Number.isFinite(seen)) {
    const minutes = (+now - seen) / 60_000;
    if (minutes < config.takeoverAfterMinutes) return { act: false, reason: 'mac_alive' };
  }
  return { act: true, reason: null };
}

function dayKey(now) {
  return new Date(+now).toISOString().slice(0, 10);
}

/** 系统运行报告：服务器自己就能算出来的那部分。 */
export function buildHeartbeatEvent({ status, now = new Date() }) {
  const sources = Array.isArray(status?.sources) ? status.sources : [];
  const stale = sources.filter((item) => item.stale === true);
  const alive = sources.filter((item) => item.stale !== true);
  const names = (rows) => rows.map((item) => item.name).join('、');
  return {
    dedupe_key: `server-worker:heartbeat:${dayKey(now)}`,
    category: 'system',
    symbol: null,
    icon: stale.length > 0 ? '❗' : '✅',
    text: stale.length > 0
      ? `系统运行报告 · 已停：${names(stale)} · 照常：${names(alive) || '无'} · 服务器接管了这条报告`
      : `系统运行报告 · ${names(alive)} 都正常`,
    value: stale.length,
    threshold: null,
    session: 'closed',
    occurred_at: new Date(+now).toISOString(),
    indicators: { level: stale.length > 0 ? 1 : 3 },
  };
}

export async function runServerWorkerTick({
  config, status, workerSeenAt, now = new Date(), append, dispatch, firedKeys = new Set(),
}) {
  const decision = shouldServerWorkerAct({ config, workerSeenAt, now });
  if (!decision.act) return { acted: false, reason: decision.reason, pushed: false };
  const event = buildHeartbeatEvent({ status, now });
  if (firedKeys.has(event.dedupe_key)) return { acted: false, reason: 'already_sent', pushed: false };
  await append(event);
  if (!config.push) return { acted: true, reason: null, pushed: false };
  const result = await dispatch({
    key: event.dedupe_key,
    dedupeKey: event.dedupe_key,
    category: 'data',
    title: '系统运行报告',
    body: event.text,
    createdAt: event.occurred_at,
  });
  return { acted: true, reason: null, pushed: result?.status === 'sent' };
}
