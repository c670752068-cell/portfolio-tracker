import type { QuantChannelReviewSnapshot, ZBreakoutEvent } from './types';
export const breakoutLabel = (direction: 'up' | 'down') => direction === 'up' ? '↑ 向上露头' : '↓ 向下露头';
const z = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
export const breakoutDescription = (event: ZBreakoutEvent) => `${breakoutLabel(event.direction)} · 连续${event.direction === 'up' ? '负' : '正'}值 ${event.sessions} 个交易日 · ${z(event.previous_z)} → ${z(event.z)} · ${event.date} 已收盘确认`;
export function currentBreakout(review: QuantChannelReviewSnapshot, symbol: string) {
  const item = review.breakouts?.[symbol];
  return item?.status === 'triggered' && item.as_of === review.breakout_date
    && item.event?.date === review.breakout_date && !review.symbols[symbol]?.stale ? item.event : null;
}
