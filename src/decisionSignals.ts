import { buildCompactBuyDecision } from './compactBuyDecision';
import type { QuantAnalysisSnapshot, QuantChannelAlert, QuantChannelAlertState, QuantMaSlopeDashboardPoint } from './types';

export function zSignal(value: number | null | undefined): QuantChannelAlertState {
  if (value == null || !Number.isFinite(value)) return 'insufficient';
  if (value <= -1.5) return 'buy';
  if (value <= -1.25) return 'buy_near';
  if (value >= 1.5) return 'sell';
  if (value >= 1.25) return 'sell_near';
  return 'neutral';
}

// Decision-page observation buckets are intentionally broader than the
// threshold alerts above.  Any reviewed value below zero belongs to the buy
// watchlist and any value above zero belongs to the sell watchlist.  Keep the
// two functions separate so a small sign change never masquerades as a ±1.5
// extreme or triggers its push notification.
export function zObservationSignal(value: number | null | undefined): QuantChannelAlertState {
  if (value == null || !Number.isFinite(value)) return 'insufficient';
  if (value < 0) return 'buy_near';
  if (value > 0) return 'sell_near';
  return 'neutral';
}

export const SIGNAL_LABELS: Record<QuantChannelAlertState, string> = {
  buy: '买入区', buy_near: '接近买', sell: '卖出区', sell_near: '接近卖', neutral: '中性', insufficient: '数据不足',
};
export const SIGNAL_RANGES: Record<QuantChannelAlertState, string> = {
  buy: 'Z ≤ −1.50', buy_near: '−1.50 < Z ≤ −1.25', sell: 'Z ≥ +1.50',
  sell_near: '+1.25 ≤ Z < +1.50', neutral: '−1.25 < Z < +1.25', insufficient: '等待可靠数据',
};
export const OBSERVATION_LABELS: Record<QuantChannelAlertState, string> = {
  buy: '买入观察', buy_near: '买入观察', sell: '卖出观察', sell_near: '卖出观察', neutral: '中性', insufficient: '数据不足',
};
export const OBSERVATION_RANGES: Record<QuantChannelAlertState, string> = {
  buy: 'Z < 0 · 归入买入观察', buy_near: 'Z < 0 · 归入买入观察',
  sell: 'Z > 0 · 归入卖出观察', sell_near: 'Z > 0 · 归入卖出观察',
  neutral: 'Z = 0 · 中性', insufficient: '等待可靠数据',
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
