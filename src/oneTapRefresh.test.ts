import { describe, expect, it, vi } from 'vitest';
import {
  ONE_TAP_REFRESH_COOLDOWN_MS,
  oneTapRefreshCooldownSeconds,
  runOneTapRefresh,
  type OneTapRefreshState,
} from './oneTapRefresh';

describe('one-tap refresh orchestration', () => {
  it('requests a recompute, refreshes existing data immediately, polls, then refreshes again', async () => {
    const calls: string[] = [];
    const states: OneTapRefreshState[] = [];
    const request = vi.fn(async () => {
      calls.push('request');
      return { ok: true as const, requested_at: '2026-07-23T12:00:00.000Z' };
    });
    const refreshExisting = vi.fn(async () => {
      calls.push('refresh');
    });
    const read = vi
      .fn()
      .mockImplementationOnce(async () => {
        calls.push('read:pending');
        return { status: 'pending' as const };
      })
      .mockImplementationOnce(async () => {
        calls.push('read:done');
        return {
          status: 'done' as const,
          completed_at: '2026-07-23T12:00:20.000Z',
          result: { ok: true },
        };
      });

    await runOneTapRefresh({
      request,
      refreshExisting,
      read,
      wait: async () => undefined,
      onState: (state) => states.push(state),
      pollIntervalMs: 5_000,
      timeoutMs: 180_000,
    });

    expect(calls).toEqual([
      'request',
      'refresh',
      'read:pending',
      'read:done',
      'refresh',
    ]);
    expect(states.map((state) => state.phase)).toEqual([
      'requested',
      'waiting',
      'done',
    ]);
    expect(states[0]?.message).toBe('已请求量化重算…');
    expect(states[1]?.message).toBe('正在计算（约 1 分钟）…');
    expect(states[2]).toMatchObject({
      message: '已更新',
      completedAt: '2026-07-23T12:00:20.000Z',
    });
  });

  it('reports throttling while continuing to poll the existing request', async () => {
    const states: OneTapRefreshState[] = [];
    await runOneTapRefresh({
      request: async () => ({ throttled: true, requested_at: '2026-07-23T12:00:00.000Z' }),
      refreshExisting: async () => undefined,
      read: async () => ({
        status: 'done',
        completed_at: '2026-07-23T12:00:10.000Z',
        result: { ok: true },
      }),
      wait: async () => undefined,
      onState: (state) => states.push(state),
      pollIntervalMs: 5_000,
      timeoutMs: 180_000,
    });

    expect(states[0]).toMatchObject({
      phase: 'throttled',
      message: '刚刚已有刷新请求，正在处理中',
    });
    expect(states.at(-1)?.phase).toBe('done');
  });

  it('times out without clearing or replacing the currently displayed data', async () => {
    const refreshExisting = vi.fn(async () => undefined);
    const states: OneTapRefreshState[] = [];

    await runOneTapRefresh({
      request: async () => ({ ok: true, requested_at: '2026-07-23T12:00:00.000Z' }),
      refreshExisting,
      read: async () => ({ status: 'pending' }),
      wait: async () => undefined,
      onState: (state) => states.push(state),
      pollIntervalMs: 5_000,
      timeoutMs: 10_000,
    });

    expect(refreshExisting).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toEqual({
      phase: 'timeout',
      message: '量化系统未在 3 分钟内响应，可能 Mac 端未运行；已显示现有最新数据',
    });
  });

  it('blocks a second click for 60 seconds', () => {
    expect(ONE_TAP_REFRESH_COOLDOWN_MS).toBe(60_000);
    expect(oneTapRefreshCooldownSeconds(1_059_001, 1_000_000)).toBe(1);
    expect(oneTapRefreshCooldownSeconds(1_060_000, 1_000_000)).toBe(0);
  });
});
