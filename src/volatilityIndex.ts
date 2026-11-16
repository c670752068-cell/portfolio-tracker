// 恐慌指数（VXSMH / VXN / VIX）：服务器取数并缓存，网页只读。
import { useEffect, useState } from 'react';
import { pollWhileVisible } from './pollWhileVisible';
import { VIX_UNLOCK } from './positionGuard';
import { getServerVolatilityUrl } from './runtimeConfig';

export const VOLATILITY_DEFAULT_KEY = 'VXSMH';
export const VOLATILITY_REFRESH_MS = 60_000;
export const VOLATILITY_STALE_MS = 300_000;
// VXSMH 的两条线：2025-09 到 2026-11 共 288 个交易日的分布，55 和长期看 VIX 25 一样罕见。
export const VXSMH_CALM_BELOW = 40;
export const VXSMH_HIGH_FROM = 55;
// 走势图上的买点线：VIX 25 是定好的门槛，VXN 30 和 VXSMH 55 是和 VIX 25 一样罕见的位置。
const BUY_LINES: Readonly<Record<string, number>> = { VXSMH: VXSMH_HIGH_FROM, VXN: 30, VIX: VIX_UNLOCK };

// 通道下沿：ETF 的 Z ≤ −1.5，就是收盘价跌破 200 日均线 −1.5σ。
export const CHANNEL_BREAK_Z = -1.5;

/** z：同一天对应 ETF 的 Z（没有就是 null）。 */
export interface VolatilityPoint { date: string; close: number; z?: number | null }
export interface VolatilityUnderlying {
  symbol: string;
  asOf: string | null;
  close: number | null;
  lowerBand: number | null;
  zScore: number | null;
}
export interface VolatilityItem {
  key: string;
  name: string;
  symbol: string;
  price: number | null;
  changePercent: number | null;
  quoteTime: string | null;
  series: VolatilityPoint[];
  underlying?: VolatilityUnderlying | null;
}
export interface VolatilityData { time: string | null; items: VolatilityItem[] }

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseSeries(value: unknown): VolatilityPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    const point = record(raw);
    const close = finite(point.close);
    return typeof point.date === 'string' && point.date !== '' && close !== null
      ? [{ date: point.date, close, z: finite(point.z) }]
      : [];
  });
}

function parseUnderlying(value: unknown): VolatilityUnderlying | null {
  const raw = record(value);
  if (typeof raw.symbol !== 'string' || raw.symbol === '') return null;
  return {
    symbol: raw.symbol,
    asOf: typeof raw.as_of === 'string' ? raw.as_of : null,
    close: finite(raw.close),
    lowerBand: finite(raw.lower_band),
    zScore: finite(raw.z_score),
  };
}

export function parseVolatility(body: unknown): VolatilityData {
  const store = record(record(body).volatility);
  const rows = Array.isArray(store.items) ? store.items : [];
  return {
    time: typeof store.time === 'string' ? store.time : null,
    items: rows.map((raw) => {
      const item = record(raw);
      return {
        key: String(item.key || ''),
        name: String(item.name || ''),
        symbol: String(item.symbol || ''),
        price: finite(item.price),
        changePercent: finite(item.change_percent),
        quoteTime: typeof item.quote_time === 'string' ? item.quote_time : null,
        series: parseSeries(item.series),
        underlying: parseUnderlying(item.underlying),
      };
    }),
  };
}

export async function fetchVolatility(endpoint: string, signal?: AbortSignal): Promise<VolatilityData> {
  const response = await fetch(endpoint, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`恐慌指数读取失败（HTTP ${response.status}）`);
  return parseVolatility(await response.json());
}

export function volatilityBuyLine(key: string): number | null {
  return BUY_LINES[key] ?? null;
}

/** 只看恐慌指数本身：到没到线。到线只说明「波动大」，不等于买点，见 buySignal。 */
export function reachedBuyLine(item: VolatilityItem): boolean {
  const line = volatilityBuyLine(item.key);
  return line !== null && item.price !== null && item.price >= line;
}

export function channelBroken(z: number | null | undefined): boolean | null {
  return typeof z === 'number' && Number.isFinite(z) ? z <= CHANNEL_BREAK_Z : null;
}

/**
 * 买点 = 恐慌指数到线 且 对应 ETF 击穿通道下沿。价格优先：
 * - buy：两样都到了，真买点
 * - wait_price：波动到线，但价格还在通道里（比如 6 月那种涨上去的高波动），不买
 * - wait_fear：价格已破下沿，恐慌还没到线
 * - none：都没到
 * - unknown：恐慌到线了，但 ETF 通道数据缺，不敢说是买点
 */
export type BuyState = 'buy' | 'wait_price' | 'wait_fear' | 'none' | 'unknown';

export function buySignal(item: VolatilityItem): BuyState {
  const fear = reachedBuyLine(item);
  const broken = channelBroken(item.underlying?.zScore);
  if (broken === null) return fear ? 'unknown' : 'none';
  if (fear) return broken ? 'buy' : 'wait_price';
  return broken ? 'wait_fear' : 'none';
}

/** ETF 现价离通道下沿多远（%）：正数 = 还在下沿上方，负数 = 已跌破。 */
export function lowerBandGap(underlying: VolatilityUnderlying | null | undefined): number | null {
  if (!underlying || underlying.close === null || underlying.lowerBand === null || underlying.lowerBand <= 0) return null;
  return (underlying.close / underlying.lowerBand - 1) * 100;
}

/** 走势图上恐慌到线的那几天：同一天 ETF 击穿下沿是真买点，没击穿只是波动大。 */
export function pointBuyState(point: VolatilityPoint, line: number | null): 'buy' | 'fear_only' | null {
  if (line === null || point.close < line) return null;
  return channelBroken(point.z) === true ? 'buy' : 'fear_only';
}

export function vxsmhZone(price: number | null): '平稳' | '平常' | '高波动' | null {
  if (price === null) return null;
  if (price < VXSMH_CALM_BELOW) return '平稳';
  return price >= VXSMH_HIGH_FROM ? '高波动' : '平常';
}

export function latestQuoteTime(items: readonly VolatilityItem[]): string | null {
  return items.reduce<string | null>(
    (latest, item) => (item.quoteTime !== null && (latest === null || item.quoteTime > latest) ? item.quoteTime : latest),
    null,
  );
}

export function pickVolatilityItem(items: readonly VolatilityItem[], key: string): VolatilityItem | null {
  return items.find((item) => item.key === key) ?? items[0] ?? null;
}

/** 60 秒取一次；失败保留上一份，过 5 分钟算 stale。 */
export function useVolatility(): { data: VolatilityData | null; stale: boolean; failed: boolean } {
  const [data, setData] = useState<VolatilityData | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const endpoint = getServerVolatilityUrl() || '/api/portfolio/volatility';
    const controller = new AbortController();
    let stopped = false;
    const pull = async () => {
      try {
        const next = await fetchVolatility(endpoint, controller.signal);
        if (stopped) return;
        setData(next);
        setFetchedAt(Date.now());
        setFailed(false);
      } catch {
        if (!stopped) setFailed(true);
      } finally {
        if (!stopped) setNow(Date.now());
      }
    };
    const stop = pollWhileVisible(() => void pull(), VOLATILITY_REFRESH_MS);
    return () => {
      stopped = true;
      controller.abort();
      stop();
    };
  }, []);

  return { data, stale: fetchedAt !== null && now - fetchedAt > VOLATILITY_STALE_MS, failed };
}
