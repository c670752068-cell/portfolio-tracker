import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { currentBreakout } from './breakoutSignals';
import { BreakoutDetails } from './components/BreakoutDetails';
import type { QuantChannelReviewSnapshot, ZBreakoutEvent } from './types';
const event: ZBreakoutEvent = { id: 'AMZN:2026-09-16:down', symbol: 'AMZN', date: '2026-09-16', direction: 'down', sessions: 18, previous_z: 0.08, z: -0.04, confirmed: true };
const review: QuantChannelReviewSnapshot = { review_time: '16:20', timezone: 'America/New_York', review_date: '2026-09-16', updated_at: null, symbols: {}, breakout_date: '2026-09-16', breakouts: { AMZN: { status: 'triggered', as_of: '2026-09-16', event, reason: '' } }, breakout_history: [event] };
describe('breakout display is independent of Z buy/sell classes', () => {
  it('shows a confirmed zero crossing without upgrading a neutral Z to buy/sell', () => {
    const html = renderToStaticMarkup(<BreakoutDetails review={review} symbol="AMZN" preview={false} />);
    expect(html).toContain('向下露头'); expect(html).toContain('18 个交易日'); expect(html).toContain('+0.080 → -0.040');
    expect(html).toContain('不等于买卖'); expect(html).not.toContain('signal-buy'); expect(html).not.toContain('signal-sell');
  });
  it('keeps yesterday in history but never matches the current-session filter', () => {
    expect(currentBreakout({ ...review, breakout_date: '2026-09-17' }, 'AMZN')).toBeNull();
    expect(currentBreakout({ ...review, symbols: { AMZN: { stale: true } as never } }, 'AMZN')).toBeNull();
    const html = renderToStaticMarkup(<BreakoutDetails review={review} symbol="AMZN" preview />);
    expect(html).toContain('盘中不确认'); expect(html).toContain('历史记录不算当日新增');
  });
});
