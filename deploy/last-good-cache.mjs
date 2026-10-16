// 行情上游（Yahoo）偶发失败时，宁可展示上一份完整数据，也不要把页面清空：
// fresh() 只在 TTL 内返回，lastGood() 不看年龄。过期条目留着当兜底，
// 但条目总数有上限，内存不会无界增长。
const DEFAULT_MAX_ENTRIES = 256;

export function createLastGoodCache({ maxEntries = DEFAULT_MAX_ENTRIES, clock = () => Date.now() } = {}) {
  const entries = new Map();
  return {
    fresh(key, ttlMs) {
      const entry = entries.get(key);
      if (!entry) return null;
      return clock() - entry.storedAt < ttlMs ? entry.value : null;
    },
    lastGood(key) {
      const entry = entries.get(key);
      return entry ? entry.value : null;
    },
    store(key, value) {
      entries.delete(key);
      if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
      entries.set(key, { storedAt: clock(), value });
    },
    get size() {
      return entries.size;
    },
  };
}
