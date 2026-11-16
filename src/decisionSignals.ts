import { buildCompactBuyDecision } from './compactBuyDecision';
import { marketSessionDateKey, sessionLabel } from './marketSession';
import type { QuantAnalysisSnapshot, QuantChannelAlert, QuantChannelAlertState, QuantMaSlopeDashboardPoint } from './types';

export function zSignal(value: number | null | undefined): QuantChannelAlertState {
  if (value == null || !Number.isFinite(value)) return 'insufficient';
  if (value <= -1.5) return 'buy';
  if (value <= -1.25) return 'buy_near';
  if (value >= 1.5) return 'sell';
  if (value >= 1.25) return 'sell_near';
  return 'neutral';
}

// 决策页的观察分区：只看顶部和底部，中间不操作，价格优先。
// 买：击穿 200 日均线 −1.5σ 通道下沿（Z ≤ −1.5）才算买点，−1.5 ~ −1.25 只是接近下沿。
// 卖：突破 +1.5σ 通道上沿（Z ≥ +1.5）才算卖点，+1.25 ~ +1.5 只是接近上沿。
// 其余都在通道中间。档位和趋势图上的通道提醒（ma-slope-query 的 buildChannelAlert）一致。
// 这里只决定标签和筛选，推送仍然只走 signalInbox 的 ±1.5 极值。
export const OBSERVATION_NEAR_Z = 1.25;

export function zObservationSignal(value: number | null | undefined): QuantChannelAlertState {
  return zSignal(value);
}

/** 「接近 / 击穿下沿」筛选：Z ≤ −1.25。 */
export function nearLowerBand(value: number | null | undefined): boolean {
  return value != null && Number.isFinite(value) && value <= -OBSERVATION_NEAR_Z;
}

/** 「接近 / 突破上沿」筛选：Z ≥ +1.25。 */
export function nearUpperBand(value: number | null | undefined): boolean {
  return value != null && Number.isFinite(value) && value >= OBSERVATION_NEAR_Z;
}

/** 「通道中间」筛选：−1.25 < Z < +1.25，不操作。 */
export function midChannel(value: number | null | undefined): boolean {
  return value != null && Number.isFinite(value) && Math.abs(value) < OBSERVATION_NEAR_Z;
}

// 决策表点 Z-Score 表头排序，和 Excel 一样从高到低 / 从低到高；没有 Z 的始终排最后。
export function compareZ(order: 'desc' | 'asc') {
  return (left: { z: number | null }, right: { z: number | null }) => {
    if (left.z == null || right.z == null) return Number(left.z == null) - Number(right.z == null);
    return order === 'desc' ? right.z - left.z : left.z - right.z;
  };
}

export const SIGNAL_LABELS: Record<QuantChannelAlertState, string> = {
  buy: '买入区', buy_near: '接近买', sell: '卖出区', sell_near: '接近卖', neutral: '中性', insufficient: '数据不足',
};
export const SIGNAL_RANGES: Record<QuantChannelAlertState, string> = {
  buy: 'Z ≤ −1.50', buy_near: '−1.50 < Z ≤ −1.25', sell: 'Z ≥ +1.50',
  sell_near: '+1.25 ≤ Z < +1.50', neutral: '−1.25 < Z < +1.25', insufficient: '等待可靠数据',
};
export const OBSERVATION_LABELS: Record<QuantChannelAlertState, string> = {
  buy: '已击穿下沿', buy_near: '接近下沿', sell: '已突破上沿', sell_near: '接近上沿', neutral: '通道中间', insufficient: '数据不足',
};
export const OBSERVATION_RANGES: Record<QuantChannelAlertState, string> = {
  buy: 'Z ≤ −1.50 · 击穿通道下沿，到买点', buy_near: '−1.50 < Z ≤ −1.25 · 接近下沿，还没击穿',
  sell: 'Z ≥ +1.50 · 突破通道上沿，到卖点', sell_near: '+1.25 ≤ Z < +1.50 · 接近上沿，还没突破',
  neutral: '−1.25 < Z < +1.25 · 通道中间，不操作', insufficient: '等待可靠数据',
};

// 一次刷新失败只说明没拿到新数据，不代表上一份完整收盘作废：观察分区继续
// 显示最近一份完整收盘的 Z，日期就在旁边。±1.5 的推送仍走 signalInbox，
// 那里不接受 stale 数据，所以刷新失败不会推送。
export function reviewedZ(alert: QuantChannelAlert | undefined): number | null {
  return alert?.available && alert.as_of && Number.isFinite(alert.z_score)
    ? alert.z_score! : null;
}

// Always use 20 trading sessions, independent of the chart's configurable slope window.
export function annualSlope(points: readonly QuantMaSlopeDashboardPoint[], date: string): number | null {
  const index = points.findIndex((point) => point.date === date);
  const current = points[index]?.ma200;
  const comparison = points[index - 20]?.ma200;
  return current != null && comparison != null && Number.isFinite(current) && Number.isFinite(comparison) && comparison > 0
    ? (current / comparison - 1) * 252 / 20 * 100 : null;
}

export type ExtendedSession = 'pre' | 'post' | 'overnight';
export interface PreviewQuote { price: number | null; stale: boolean; session: string | null; priceTime: string | null }

/** 报价接口（/api/quotes）返回里这只股票的现价和服务器判定的时段。 */
export function previewQuoteFrom(body: unknown, symbol: string): PreviewQuote | null {
  const value = (typeof body === 'object' && body !== null ? body : {}) as { quotes?: unknown; session?: unknown };
  const rows = Array.isArray(value.quotes) ? value.quotes as Array<Record<string, unknown>> : [];
  const row = rows.find((item) => String(item?.symbol || '').toUpperCase() === symbol.toUpperCase());
  if (!row) return null;
  return {
    price: typeof row.price === 'number' && Number.isFinite(row.price) ? row.price : null,
    stale: row.stale === true,
    session: typeof value.session === 'string' ? value.session : null,
    priceTime: typeof row.priceTime === 'string' ? row.priceTime : null,
  };
}

/**
 * 夜盘、盘前、盘后没有「未收盘那根」日线：拿现价和最后一根走完的日线的 200 日均值/标准差
 * 估一个 Z（和服务器 Z 提醒同一算法）。「走完」按美东时间判：早于今天，或今天且已过 16:00，
 * 缓存里那根还标着未收盘也照样当基准。
 */
export function estimatedPreview(
  points: readonly QuantMaSlopeDashboardPoint[], quote: PreviewQuote | null, now = new Date(),
): { date: string; close: number; z: number; annualSlope: number | null; slopeDate: string; session: ExtendedSession } | null {
  const session = quote?.session;
  if (session !== 'pre' && session !== 'post' && session !== 'overnight') return null;
  // 没有成交时间的价多半是退回来的白天收盘价，不能冒充夜盘价
  if (!quote || quote.stale || quote.price === null || !quote.priceTime) return null;
  const today = marketSessionDateKey(now);
  const closedToday = sessionLabel(now) === '已收盘';
  const base = points.findLast((point) => point.date < today || (point.date === today && closedToday));
  const mean = base?.ma200;
  const deviation = base?.std200;
  if (!base || mean == null || deviation == null || !Number.isFinite(mean) || !(deviation > 0)) return null;
  return {
    date: marketSessionDateKey(quote.priceTime ? new Date(quote.priceTime) : now),
    close: quote.price,
    z: (quote.price - mean) / deviation,
    annualSlope: annualSlope(points, base.date),
    slopeDate: base.date,
    session,
  };
}

export function decisionSignalRow(snapshot: QuantAnalysisSnapshot, symbol: string, alert?: QuantChannelAlert) {
  const decision = buildCompactBuyDecision(snapshot, symbol);
  const slope = decision.maSlope;
  const z = reviewedZ(alert);
  return {
    symbol, decision, z, state: zObservationSignal(z), asOf: alert?.as_of ?? null,
    slope: slope?.available && Number.isFinite(slope.annualized_pct) ? slope.annualized_pct : null,
    slopeAsOf: slope?.as_of ?? null,
    drawdownReached: decision.currentDrawdownPct != null && decision.thresholdPct != null
      ? decision.currentDrawdownPct >= decision.thresholdPct : null,
  };
}

export function zBarColor(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '#94a3b8';
  if (value >= 1.5) return '#dc2626';
  if (value > 0) return '#f87171';
  if (value <= -1.5) return '#059669';
  return '#6ee7b7';
}
