import { describe, expect, it } from 'vitest';
import { createLastGoodCache } from './last-good-cache.mjs';

describe('最近一份完整数据的缓存', () => {
  it('TTL 内算新鲜；过期后不再当新鲜，但仍能取回上一份完整数据', () => {
    let now = 1_000;
    const cache = createLastGoodCache({ clock: () => now });
    cache.store('NVDA', { as_of: '2026-10-15' });

    expect(cache.fresh('NVDA', 5 * 60_000)).toEqual({ as_of: '2026-10-15' });
    now += 5 * 60_000;
    expect(cache.fresh('NVDA', 5 * 60_000)).toBeNull();
    expect(cache.lastGood('NVDA')).toEqual({ as_of: '2026-10-15' });
  });

  it('没存过就什么都没有', () => {
    const cache = createLastGoodCache();

    expect(cache.fresh('NVDA', 1_000)).toBeNull();
    expect(cache.lastGood('NVDA')).toBeNull();
  });

  it('新的完整数据覆盖旧的，并重新计时', () => {
    let now = 0;
    const cache = createLastGoodCache({ clock: () => now });
    cache.store('NVDA', { as_of: '2026-10-14' });
    now += 10 * 60_000;
    cache.store('NVDA', { as_of: '2026-10-15' });

    expect(cache.fresh('NVDA', 5 * 60_000)).toEqual({ as_of: '2026-10-15' });
    expect(cache.lastGood('NVDA')).toEqual({ as_of: '2026-10-15' });
  });

  it('超过上限时丢最早的条目，内存不会无界增长', () => {
    const cache = createLastGoodCache({ maxEntries: 2 });
    cache.store('A', 1);
    cache.store('B', 2);
    cache.store('C', 3);

    expect(cache.lastGood('A')).toBeNull();
    expect(cache.lastGood('B')).toBe(2);
    expect(cache.lastGood('C')).toBe(3);
  });
});
