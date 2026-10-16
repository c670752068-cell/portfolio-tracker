import type {
  QuantMaSlopeDashboard,
  QuantMaSlopeDashboardRange,
  QuantMaSlopeSnapshot,
  QuantChannelReviewSnapshot,
} from './types';

export interface MaSlopeQueryResult extends QuantMaSlopeSnapshot {
  symbol: string;
  decision_use: false;
}

export interface MaSlopeDashboardResult {
  symbol: string;
  available: boolean;
  decision_use: false;
  buy_veto: false;
  query_source: 'custom_dashboard';
  data_source: string;
  price_adjustment: string;
  as_of: string | null;
  required_bars: number;
  observed_bars: number;
  reason: string;
  dashboard: QuantMaSlopeDashboard;
}

export interface MaSlopeDashboardOptions {
  range: QuantMaSlopeDashboardRange;
  slopeWindow: number;
  refresh?: boolean;
  signal?: AbortSignal;
}

export function normalizeMaSlopeSymbol(value: string): string {
  const symbol = value.trim().toUpperCase();
  if (!/^\^?[A-Z][A-Z0-9.-]{0,10}$/.test(symbol)) {
    throw new Error('股票代码格式不正确，请输入 1–11 位美股或指数代码');
  }
  return symbol;
}

export async function fetchMaSlopeQuery(
  endpoint: string,
  rawSymbol: string,
  signal?: AbortSignal,
): Promise<MaSlopeQueryResult> {
  const symbol = normalizeMaSlopeSymbol(rawSymbol);
  const separator = endpoint.includes('?') ? '&' : '?';
  const response = await fetch(`${endpoint}${separator}symbol=${encodeURIComponent(symbol)}`, {
    cache: 'no-store',
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message;
    throw new Error(typeof message === 'string' ? message : `斜率查询失败（HTTP ${response.status}）`);
  }
  return body as MaSlopeQueryResult;
}

export async function fetchMaSlopeDashboard(
  endpoint: string,
  rawSymbol: string,
  options: MaSlopeDashboardOptions,
): Promise<MaSlopeDashboardResult> {
  const symbol = normalizeMaSlopeSymbol(rawSymbol);
  const separator = endpoint.includes('?') ? '&' : '?';
  const query = new URLSearchParams({
    symbol,
    view: 'dashboard',
    range: options.range,
    slope_window: String(options.slopeWindow),
  });
  if (options.refresh) query.set('refresh', '1');
  const response = await fetch(`${endpoint}${separator}${query}`, {
    cache: 'no-store', signal: options.signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message;
    throw new Error(typeof message === 'string' ? message : `K 线斜率查询失败（HTTP ${response.status}）`);
  }
  return body as MaSlopeDashboardResult;
}

export async function fetchChannelReview(
  endpoint: string,
  signal?: AbortSignal,
): Promise<QuantChannelReviewSnapshot> {
  const response = await fetch(endpoint, { cache: 'no-store', signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message;
    throw new Error(typeof message === 'string' ? message : `通道审查读取失败（HTTP ${response.status}）`);
  }
  return body as QuantChannelReviewSnapshot;
}
