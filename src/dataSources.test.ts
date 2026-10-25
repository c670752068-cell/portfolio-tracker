import { describe, expect, it } from 'vitest';
import { locationText, parseDataSources, sourceAgeText } from './dataSources';

const payload = {
  status: {
    version: 1,
    generated_at: '2026-10-25T14:00:00.000Z',
    macAlive: false,
    sources: [
      { key: 'positions', name: '持仓与现金', location: 'mac', updatedAt: '2026-10-24T20:19:00.000Z', ageMinutes: 1061, stale: true, note: '由 Mac 上的量化系统推送' },
      { key: 'realtime_quotes', name: '实时报价', location: 'server', updatedAt: null, ageMinutes: null, stale: false, note: '服务器自己取' },
      { key: 'server_opend', name: '服务器 OpenD', location: 'server', ready: false, reason: 'not_configured', stale: false, updatedAt: null, ageMinutes: null },
    ],
  },
};

describe('数据状态的读取与显示', () => {
  it('解析接口返回', () => {
    const parsed = parseDataSources(payload);

    expect(parsed.macAlive).toBe(false);
    expect(parsed.sources).toHaveLength(3);
    expect(parsed.sources[0]).toMatchObject({ key: 'positions', location: 'mac', stale: true });
  });

  it('返回坏了给空结构，不让设置页炸', () => {
    expect(parseDataSources(null).sources).toEqual([]);
    expect(parseDataSources({ status: { sources: 'x' } }).sources).toEqual([]);
  });

  it('位置写成中文', () => {
    expect(locationText('mac')).toBe('本机（Mac）');
    expect(locationText('server')).toBe('服务器');
    expect(locationText('x')).toBe('未知');
  });

  it('最后更新写成「x 分钟前 / x 小时前」，从未更新写「从未」', () => {
    expect(sourceAgeText({ ageMinutes: 3, stale: false })).toBe('3 分钟前');
    expect(sourceAgeText({ ageMinutes: 130, stale: false })).toBe('2 小时前');
    expect(sourceAgeText({ ageMinutes: 1061, stale: true })).toBe('18 小时前 · 已过期');
    expect(sourceAgeText({ ageMinutes: null, stale: true })).toBe('从未');
    expect(sourceAgeText({ ageMinutes: null, stale: false })).toBe('服务器实时取数');
  });
});

describe('现在用不上的数据源', () => {
  it('夜盘报价在白天显示「现在不用」，不说成服务器实时取数', () => {
    expect(sourceAgeText({ ageMinutes: null, stale: false, applicable: false })).toBe('现在不用');
  });

  it('普通的服务器数据源照旧', () => {
    expect(sourceAgeText({ ageMinutes: null, stale: false })).toBe('服务器实时取数');
  });
});
