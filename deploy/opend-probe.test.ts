import { describe, expect, it } from 'vitest';
import { OPEND_PROBE_TTL_MS, makeOpendProbe, probeOpend } from './opend-probe.mjs';

const okConnect = async () => true;
const refusedConnect = async () => { throw new Error('ECONNREFUSED'); };

describe('探测服务器上的 OpenD', () => {
  it('配置文件不在时说「没配置」，不去连端口', async () => {
    let tried = false;
    const result = await probeOpend({
      configExists: async () => false,
      connect: async () => { tried = true; return true; },
    });
    expect(result.configured).toBe(false);
    expect(result.reachable).toBe(false);
    expect(result.reason).toBe('not_configured');
    expect(tried).toBe(false);
  });

  it('配置在、端口连得上 → 可用', async () => {
    const result = await probeOpend({ configExists: async () => true, connect: okConnect });
    expect(result.configured).toBe(true);
    expect(result.reachable).toBe(true);
    expect(result.reason).toBe(null);
  });

  it('配置在、端口连不上 → 连不上', async () => {
    const result = await probeOpend({ configExists: async () => true, connect: refusedConnect });
    expect(result.configured).toBe(true);
    expect(result.reachable).toBe(false);
    expect(result.reason).toBe('connect_refused');
  });

  it('不声称知道有没有登录过：TCP 连通证明不了这件事', async () => {
    const result = await probeOpend({ configExists: async () => true, connect: okConnect });
    expect(result.loggedIn).toBe(null);
  });

  it('带上探测时间', async () => {
    const now = new Date('2026-10-26T03:30:00Z');
    const result = await probeOpend({ configExists: async () => true, connect: okConnect, now });
    expect(result.checkedAt).toBe('2026-10-26T03:30:00.000Z');
  });
});

describe('探测结果缓存', () => {
  it('TTL 内重复调用只真探测一次', async () => {
    let calls = 0;
    const clock = 1000;
    const probe = makeOpendProbe({
      configExists: async () => true,
      connect: async () => { calls += 1; return true; },
      now: () => new Date(clock),
    });
    await probe();
    await probe();
    expect(calls).toBe(1);
  });

  it('过了 TTL 会重新探测', async () => {
    let calls = 0;
    let clock = 1000;
    const probe = makeOpendProbe({
      configExists: async () => true,
      connect: async () => { calls += 1; return true; },
      now: () => new Date(clock),
    });
    await probe();
    clock += OPEND_PROBE_TTL_MS + 1;
    await probe();
    expect(calls).toBe(2);
  });
});
