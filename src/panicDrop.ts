// 恐慌性下跌（标普收盘跌 3% 以上且三大指数同跌）：服务器按完整收盘判定，网页只读。
import { useEffect, useState } from 'react';
import { pollWhileVisible } from './pollWhileVisible';
import { getServerPanicDropUrl } from './runtimeConfig';

export const PANIC_REFRESH_MS = 300_000;

export interface PanicDay {
  date: string;
  sp500: number | null;
  dow: number | null;
  nasdaq: number | null;
  panic: boolean;
}
export interface PanicDrop {
  asOf: string | null;
  /** 恐慌窗口开着才可能超过 30%；null 是数据拿不到，不等于没有恐慌。 */
  windowOpen: boolean | null;
  anchorClose: number | null;
  recoveredOn: string | null;
  lastPanic: PanicDay | null;
  days: PanicDay[];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function parseDay(raw: unknown): PanicDay | null {
  const day = record(raw);
  const date = text(day.date);
  if (date === null) return null;
  return { date, sp500: finite(day.sp500), dow: finite(day.dow), nasdaq: finite(day.nasdaq), panic: day.panic === true };
}

export function parsePanicDrop(body: unknown): PanicDrop {
  const store = record(record(body).panic);
  const rows = Array.isArray(store.days) ? store.days : [];
  return {
    asOf: text(store.as_of),
    windowOpen: typeof store.window_open === 'boolean' ? store.window_open : null,
    anchorClose: finite(store.anchor_close),
    recoveredOn: text(store.recovered_on),
    lastPanic: parseDay(store.last_panic),
    days: rows.flatMap((raw) => parseDay(raw) ?? []),
  };
}

async function fetchPanicDrop(endpoint: string, signal: AbortSignal): Promise<PanicDrop> {
  const response = await fetch(endpoint, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`恐慌性下跌读取失败（HTTP ${response.status}）`);
  return parsePanicDrop(await response.json());
}

/** 5 分钟取一次；失败保留上一份，一直没有就是 null（上限显示暂无）。 */
export function usePanicDrop(): PanicDrop | null {
  const [panic, setPanic] = useState<PanicDrop | null>(null);
  useEffect(() => {
    const endpoint = getServerPanicDropUrl() || '/api/portfolio/panic-drop';
    const controller = new AbortController();
    const stop = pollWhileVisible(() => {
      fetchPanicDrop(endpoint, controller.signal).then(setPanic).catch((error: unknown) => {
        if (!controller.signal.aborted) console.warn('恐慌性下跌读取失败', error);
      });
    }, PANIC_REFRESH_MS);
    return () => {
      controller.abort();
      stop();
    };
  }, []);
  return panic;
}
