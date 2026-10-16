import { useEffect, useRef, useState } from 'react';
import { fetchMaSlopeDashboard, type MaSlopeDashboardResult } from './maSlopeQuery';
import { getServerMaSlopeUrl } from './runtimeConfig';

export interface DecisionTechnicalData { result?: MaSlopeDashboardResult; error?: string; revision: string; fetched: number }

// Load only visible rows and the selected ticker. Two workers cap network concurrency;
// cached successes/failures prevent filter switches from repeatedly hitting the service.
export function useDecisionTechnicals(symbolKey: string, revision: string, refreshKey: number) {
  const cache = useRef<Record<string, DecisionTechnicalData>>({});
  const [data, setData] = useState<Record<string, DecisionTechnicalData>>({});
  useEffect(() => {
    const controller = new AbortController();
    const queue = symbolKey.split(',').filter(Boolean);
    let index = 0;
    const worker = async () => {
      while (index < queue.length && !controller.signal.aborted) {
        const symbol = queue[index++];
        const old = cache.current[symbol];
        if (old?.revision === revision && Date.now() - old.fetched < 300_000) continue;
        let next: DecisionTechnicalData;
        try {
          const result = await fetchMaSlopeDashboard(getServerMaSlopeUrl() || '/api/portfolio/ma-slope', symbol, { range: '5y', slopeWindow: 8, signal: controller.signal });
          if (result.symbol !== symbol) throw new Error('返回标的不一致');
          next = { result, revision, fetched: Date.now() };
        } catch {
          next = { result: old?.result, error: old?.result ? '更新失败 · 保留旧值' : '日线暂不可用', revision, fetched: Date.now() };
        }
        if (controller.signal.aborted) return;
        cache.current[symbol] = next;
        setData(current => ({ ...current, [symbol]: next }));
      }
    };
    void Promise.all([worker(), worker()]);
    return () => controller.abort();
  }, [symbolKey, revision, refreshKey]);
  return data;
}
