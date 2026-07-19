import type { QuantOpportunitySummary } from './types';

export function opportunityStatusLabel(
  summary: QuantOpportunitySummary | undefined,
  symbol: string,
): string {
  if (!summary) return `⚪ ${symbol} · 无`;
  if (summary.buy_ready.some((item) => item.symbol === symbol)) return `🟢 ${symbol} · 可买`;
  if (summary.buy_near.some((item) => item.symbol === symbol)) return `🟡 ${symbol} · 接近`;
  if (summary.sell_ready.some((item) => item.symbol === symbol)) return `🔴 ${symbol} · 可卖`;
  return `⚪ ${symbol} · 无`;
}
