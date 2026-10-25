import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SERVER_WORKER_CONFIG, buildHeartbeatEvent, loadServerWorkerConfig, runServerWorkerTick,
  shouldServerWorkerAct,
} from './server-worker.mjs';

const NOW = new Date('2026-10-25T13:00:00.000Z'); // 美东 09:00

describe('服务器 worker 的开关', () => {
  it('默认整个关着，而且不推送', () => {
    expect(DEFAULT_SERVER_WORKER_CONFIG).toEqual({ enabled: false, push: false, takeoverAfterMinutes: 90 });
    expect(loadServerWorkerConfig(null)).toEqual(DEFAULT_SERVER_WORKER_CONFIG);
    expect(loadServerWorkerConfig({ enabled: 'yes' })).toEqual(DEFAULT_SERVER_WORKER_CONFIG);
    expect(loadServerWorkerConfig({ enabled: true, push: true, takeoverAfterMinutes: 30 }))
      .toEqual({ enabled: true, push: true, takeoverAfterMinutes: 30 });
  });
});

describe('什么时候才接管', () => {
  const config = { enabled: true, push: false, takeoverAfterMinutes: 90 };

  it('关着就不动', () => {
    expect(shouldServerWorkerAct({
      config: DEFAULT_SERVER_WORKER_CONFIG, workerSeenAt: null, now: NOW,
    })).toMatchObject({ act: false, reason: 'disabled' });
  });

  it('Mac 那份还在跑就不接管，免得重复推送', () => {
    expect(shouldServerWorkerAct({
      config, workerSeenAt: '2026-10-25T12:30:00.000Z', now: NOW,
    })).toMatchObject({ act: false, reason: 'mac_alive' });
  });

  it('Mac 那份停够久了才接管', () => {
    expect(shouldServerWorkerAct({
      config, workerSeenAt: '2026-10-25T11:00:00.000Z', now: NOW,
    })).toMatchObject({ act: true });
    expect(shouldServerWorkerAct({ config, workerSeenAt: null, now: NOW })).toMatchObject({ act: true });
  });
});

describe('系统运行报告（服务器自己能算的那部分）', () => {
  const status = {
    macAlive: false,
    sources: [
      { key: 'positions', name: '持仓与现金', location: 'mac', ageMinutes: 1061, stale: true },
      { key: 'analysis', name: '量化快照', location: 'mac', ageMinutes: 1061, stale: true },
      { key: 'realtime_quotes', name: '实时报价', location: 'server', ageMinutes: null, stale: false },
    ],
  };

  it('写清楚哪几项停了、哪几项照常', () => {
    const event = buildHeartbeatEvent({ status, now: NOW });

    expect(event).toMatchObject({ category: 'system', icon: '❗' });
    expect(event.text).toContain('持仓与现金');
    expect(event.text).toContain('实时报价');
    expect(event.dedupe_key).toBe('server-worker:heartbeat:2026-10-25');
  });

  it('全部正常时也给一条，但图标是正常的', () => {
    const ok = buildHeartbeatEvent({
      status: { macAlive: true, sources: status.sources.map((item) => ({ ...item, stale: false })) },
      now: NOW,
    });

    expect(ok.icon).toBe('✅');
    expect(ok.text).toContain('都正常');
  });
});

describe('跑一轮', () => {
  const status = { macAlive: false, sources: [{ key: 'positions', name: '持仓与现金', location: 'mac', ageMinutes: 999, stale: true }] };

  it('关着时什么都不写', async () => {
    const append = vi.fn();
    const result = await runServerWorkerTick({
      config: DEFAULT_SERVER_WORKER_CONFIG, status, workerSeenAt: null, now: NOW, append, dispatch: vi.fn(),
    });

    expect(result).toMatchObject({ acted: false });
    expect(append).not.toHaveBeenCalled();
  });

  it('打开但不推送时只写日志', async () => {
    const append = vi.fn();
    const dispatch = vi.fn();
    const result = await runServerWorkerTick({
      config: { enabled: true, push: false, takeoverAfterMinutes: 90 },
      status, workerSeenAt: null, now: NOW, append, dispatch,
    });

    expect(result).toMatchObject({ acted: true, pushed: false });
    expect(append).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('同一天只写一次', async () => {
    const append = vi.fn();
    const config = { enabled: true, push: false, takeoverAfterMinutes: 90 };
    const fired = new Set(['server-worker:heartbeat:2026-10-25']);
    const result = await runServerWorkerTick({
      config, status, workerSeenAt: null, now: NOW, append, dispatch: vi.fn(), firedKeys: fired,
    });

    expect(result).toMatchObject({ acted: false, reason: 'already_sent' });
    expect(append).not.toHaveBeenCalled();
  });

  it('打开推送开关才会真的推', async () => {
    const dispatch = vi.fn().mockResolvedValue({ status: 'sent' });
    const result = await runServerWorkerTick({
      config: { enabled: true, push: true, takeoverAfterMinutes: 90 },
      status, workerSeenAt: null, now: NOW, append: vi.fn(), dispatch,
    });

    expect(result).toMatchObject({ acted: true, pushed: true });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
