// 探测这台服务器上的 OpenD 是不是装好并且在跑。
// 只做两件事：看配置文件在不在、连一下 127.0.0.1:11111。
// TCP 连得上不代表已经登录成功（OpenD 在登录之前就会绑端口），所以不声称知道登录状态。
import { createConnection } from 'node:net';
import { access } from 'node:fs/promises';

export const OPEND_CONFIG_PATH = '/opt/futu-opend/OpenD.xml';
export const OPEND_HOST = '127.0.0.1';
export const OPEND_PORT = 11111;
export const OPEND_CONNECT_TIMEOUT_MS = 2000;
export const OPEND_PROBE_TTL_MS = 60_000;

async function defaultConfigExists() {
  try {
    await access(OPEND_CONFIG_PATH);
    return true;
  } catch {
    return false;
  }
}

function defaultConnect() {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: OPEND_HOST, port: OPEND_PORT });
    const done = (error) => {
      socket.destroy();
      if (error) reject(error);
      else resolve(true);
    };
    socket.setTimeout(OPEND_CONNECT_TIMEOUT_MS, () => done(new Error('timeout')));
    socket.once('connect', () => done(null));
    socket.once('error', (error) => done(error));
  });
}

/** 探一次。返回的对象直接喂给 buildDataSourceStatus 和 opendReadingForAlerts。 */
export async function probeOpend({
  configExists = defaultConfigExists, connect = defaultConnect, now = new Date(),
} = {}) {
  const checkedAt = new Date(+now).toISOString();
  if (!(await configExists())) {
    return { configured: false, reachable: false, loggedIn: null, reason: 'not_configured', checkedAt };
  }
  try {
    await connect();
    return { configured: true, reachable: true, loggedIn: null, reason: null, checkedAt };
  } catch {
    return { configured: true, reachable: false, loggedIn: null, reason: 'connect_refused', checkedAt };
  }
}

/** 包一层缓存：TTL 内不重复去连端口。 */
export function makeOpendProbe({ configExists, connect, now = () => new Date() } = {}) {
  let cached = null;
  let cachedAt = 0;
  return async () => {
    const current = +now();
    if (cached && current - cachedAt < OPEND_PROBE_TTL_MS) return cached;
    cached = await probeOpend({ configExists, connect, now: now() });
    cachedAt = current;
    return cached;
  };
}
