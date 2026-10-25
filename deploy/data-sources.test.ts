import { describe, expect, it } from 'vitest';
import {
  DATA_SOURCE_STALE_MS, buildDataSourceStatus, opendReadingForAlerts,
} from './data-sources.mjs';

const NOW = new Date('2026-10-25T14:00:00.000Z');

describe('数据状态：每个来源跑在哪、最后什么时候更新', () => {
  it('逐项列出位置和最后更新时间', () => {
    const status = buildDataSourceStatus({
      now: NOW,
      positionsAt: '2026-10-25T13:50:00.000Z',
      analysisAt: '2026-10-25T13:45:00.000Z',
      overnightPushAt: +new Date('2026-10-25T13:59:00.000Z'),
      workerSeenAt: '2026-10-25T13:40:00.000Z',
      opend: { reachable: false, reason: 'not_configured' },
    });

    const byKey = Object.fromEntries(status.sources.map((item) => [item.key, item]));
    expect(byKey.positions).toMatchObject({ location: 'mac', name: '持仓与现金', stale: false });
    expect(byKey.analysis).toMatchObject({ location: 'mac', name: '量化快照' });
    expect(byKey.overnight_quotes).toMatchObject({ location: 'mac', name: '夜盘报价' });
    expect(byKey.push_worker).toMatchObject({ location: 'mac', name: '定时推送' });
    expect(byKey.realtime_quotes).toMatchObject({ location: 'server', name: '实时报价' });
    expect(byKey.index_quotes).toMatchObject({ location: 'server' });
    expect(byKey.sector_rotation).toMatchObject({ location: 'server' });
    expect(byKey.server_opend).toMatchObject({ location: 'server', ready: false });
  });

  it('超过阈值就标过期，并写明停在什么时候', () => {
    const status = buildDataSourceStatus({
      now: NOW,
      positionsAt: '2026-10-24T20:19:00.000Z',
      analysisAt: '2026-10-24T20:19:00.000Z',
      overnightPushAt: null,
      workerSeenAt: '2026-10-24T20:35:00.000Z',
      opend: { reachable: false, reason: 'not_configured' },
    });
    const byKey = Object.fromEntries(status.sources.map((item) => [item.key, item]));

    expect(DATA_SOURCE_STALE_MS.positions).toBe(3 * 60 * 60 * 1000);
    expect(byKey.positions).toMatchObject({ stale: true });
    expect(byKey.positions.ageMinutes).toBeGreaterThan(1000);
    expect(status.macAlive).toBe(false);
  });

  it('从没更新过的写「从未」，不编时间', () => {
    const status = buildDataSourceStatus({ now: NOW, positionsAt: null, analysisAt: null, overnightPushAt: null, workerSeenAt: null, opend: null });
    const byKey = Object.fromEntries(status.sources.map((item) => [item.key, item]));

    expect(byKey.positions).toMatchObject({ updatedAt: null, ageMinutes: null, stale: true });
    expect(byKey.server_opend).toMatchObject({ ready: false, reason: 'not_configured' });
  });
});

describe('服务器 OpenD 的状态提醒', () => {
  it('还没配置时不报警——现在本来就没装', () => {
    expect(opendReadingForAlerts({ reachable: false, reason: 'not_configured' })).toBeNull();
  });

  it('配好了但连不上，写一条「❗ 系统」', () => {
    const reading = opendReadingForAlerts({ configured: true, reachable: false, reason: 'connect_refused' });

    expect(reading).toMatchObject({ key: 'server-opend', state: 'triggered', icon: '❗', category: 'system' });
    expect(reading.text).toContain('服务器上的 OpenD');
  });

  it('登录失效或要验证码时说清楚要做什么', () => {
    expect(opendReadingForAlerts({ configured: true, reachable: true, loggedIn: false, reason: 'need_verify_code' }).text)
      .toContain('验证码');
    expect(opendReadingForAlerts({ configured: true, reachable: true, loggedIn: false, reason: 'login_expired' }).text)
      .toContain('登录失效');
  });

  it('一切正常时是 normal，恢复才记一行', () => {
    expect(opendReadingForAlerts({ configured: true, reachable: true, loggedIn: true }))
      .toMatchObject({ state: 'normal', icon: '✅' });
  });
});

describe('夜盘报价只在夜盘时段判断新鲜度', () => {
  it('不是夜盘时段时不标「已过期」，并说明现在不需要', () => {
    const status = buildDataSourceStatus({
      now: new Date('2026-10-25T17:07:00Z'),
      overnightPushAt: null,
      overnightActive: false,
    });
    const row = status.sources.find((item) => item.key === 'overnight_quotes');
    expect(row?.stale).toBe(false);
    expect(row?.note).toContain('现在不是夜盘');
  });

  it('夜盘时段里没有推送就算过期', () => {
    const status = buildDataSourceStatus({
      now: new Date('2026-10-25T05:00:00Z'),
      overnightPushAt: null,
      overnightActive: true,
    });
    const row = status.sources.find((item) => item.key === 'overnight_quotes');
    expect(row?.stale).toBe(true);
  });

  it('非夜盘时段的夜盘报价不参与 macAlive 判断', () => {
    const status = buildDataSourceStatus({
      now: new Date('2026-10-25T17:07:00Z'),
      positionsAt: null,
      analysisAt: null,
      workerSeenAt: null,
      overnightPushAt: null,
      overnightActive: false,
    });
    expect(status.macAlive).toBe(false);
  });
});
