// 数据状态：每一样数据是「服务器自己取的」还是「Mac 推上来的」，最后什么时候更新。
// 设置页只读显示；服务器上的 OpenD 掉线、登录失效、要验证码时写一条系统提醒。
export const DATA_SOURCE_STALE_MS = {
  positions: 3 * 60 * 60 * 1000,
  analysis: 3 * 60 * 60 * 1000,
  overnight_quotes: 20 * 60 * 1000,
  push_worker: 6 * 60 * 60 * 1000,
};

function ageMinutes(at, now) {
  const time = typeof at === 'number' ? at : Date.parse(String(at || ''));
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.round((+now - time) / 60_000));
}

function isoOf(at) {
  if (typeof at === 'number' && Number.isFinite(at)) return new Date(at).toISOString();
  const time = Date.parse(String(at || ''));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function macSource({ key, name, at, now, staleMs, note }) {
  const age = ageMinutes(at, now);
  return {
    key,
    name,
    location: 'mac',
    updatedAt: isoOf(at),
    ageMinutes: age,
    stale: age === null || age * 60_000 > staleMs,
    note,
  };
}

function serverSource({ key, name, note }) {
  return { key, name, location: 'server', updatedAt: null, ageMinutes: null, stale: false, note };
}

export function buildDataSourceStatus({
  now = new Date(), positionsAt = null, analysisAt = null, overnightPushAt = null,
  workerSeenAt = null, opend = null, overnightActive = false,
} = {}) {
  const sources = [
    macSource({ key: 'positions', name: '持仓与现金', at: positionsAt, now, staleMs: DATA_SOURCE_STALE_MS.positions, note: '由 Mac 上的量化系统推送' }),
    macSource({ key: 'analysis', name: '量化快照', at: analysisAt, now, staleMs: DATA_SOURCE_STALE_MS.analysis, note: '回撤、PE、日K、均线、Z、卖出线都来自这里' }),
    overnightActive
      ? macSource({ key: 'overnight_quotes', name: '夜盘报价', at: overnightPushAt, now, staleMs: DATA_SOURCE_STALE_MS.overnight_quotes, note: 'Mac 上的 OpenD 推送；断了会退到 Nasdaq' })
      : {
        ...macSource({ key: 'overnight_quotes', name: '夜盘报价', at: overnightPushAt, now, staleMs: DATA_SOURCE_STALE_MS.overnight_quotes, note: '' }),
        stale: false,
        applicable: false,
        note: '现在不是夜盘时段，不需要',
      },
    macSource({ key: 'push_worker', name: '定时推送', at: workerSeenAt, now, staleMs: DATA_SOURCE_STALE_MS.push_worker, note: '晨间汇总、收盘检查这类按点推送' }),
    serverSource({ key: 'realtime_quotes', name: '实时报价', note: '服务器自己取，Mac 关机照常' }),
    serverSource({ key: 'index_quotes', name: '三大指数 / 期货', note: '服务器自己取' }),
    serverSource({ key: 'sector_rotation', name: '板块轮动', note: '服务器自己取' }),
    {
      key: 'server_opend',
      name: '服务器 OpenD',
      location: 'server',
      updatedAt: null,
      ageMinutes: null,
      stale: false,
      ready: opend?.reachable === true && opend?.loggedIn !== false,
      reason: opend?.reason || (opend ? null : 'not_configured'),
      note: '装好但还没登录时显示未就绪',
    },
  ];
  const macRows = sources.filter((item) => item.location === 'mac' && item.applicable !== false);
  return {
    version: 1,
    generated_at: new Date(+now).toISOString(),
    sources,
    macAlive: macRows.some((item) => item.stale === false),
  };
}

const OPEND_REASON_TEXT = {
  connect_refused: '连不上（进程没起来或端口不通）',
  need_verify_code: '需要重新输入手机验证码',
  login_expired: '登录失效，需要重新登录',
  quote_permission: '行情权限不足',
};

/** 服务器 OpenD 的状态读数；还没配置时不报警。 */
export function opendReadingForAlerts(opend) {
  if (!opend || opend.configured !== true) return null;
  const healthy = opend.reachable === true && opend.loggedIn !== false;
  const reason = String(opend.reason || '');
  return {
    key: 'server-opend',
    state: healthy ? 'normal' : 'triggered',
    category: 'system',
    symbol: null,
    icon: healthy ? '✅' : '❗',
    value: null,
    threshold: null,
    text: healthy
      ? '服务器上的 OpenD 已恢复'
      : `服务器上的 OpenD 不可用 · ${OPEND_REASON_TEXT[reason] || reason || '原因未知'} · 数据仍以 Mac 为准`,
  };
}
