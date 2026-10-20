import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadLastOpenedAt, loadReadAlertIds, saveLastOpenedAt, saveReadAlertIds,
} from './alertLog';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } satisfies Storage;
}

describe('每台设备自己记已读和上次打开时间', () => {
  beforeEach(() => vi.stubGlobal('window', { localStorage: memoryStorage() }));
  afterEach(() => vi.unstubAllGlobals());

  it('点过的重要提醒记在本机，不动服务器记录', () => {
    expect(loadReadAlertIds()).toEqual([]);
    saveReadAlertIds(['alert-1', 'alert-2']);
    expect(loadReadAlertIds()).toEqual(['alert-1', 'alert-2']);
  });

  it('上次打开时间存成 ISO 字符串，没存过返回空', () => {
    expect(loadLastOpenedAt()).toBeNull();
    saveLastOpenedAt('2026-10-20T13:40:00.000Z');
    expect(loadLastOpenedAt()).toBe('2026-10-20T13:40:00.000Z');
  });

  it('存坏了也不让页面挂掉', () => {
    window.localStorage.setItem('portfolio-tracker:alert-log:read', '不是 JSON');
    window.localStorage.setItem('portfolio-tracker:alert-log:opened', '{}');
    expect(loadReadAlertIds()).toEqual([]);
    expect(loadLastOpenedAt()).toBeNull();
  });
});
