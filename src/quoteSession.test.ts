import { describe, expect, it } from 'vitest';

import {
  closedQuoteText,
  formatPriceSession,
  quoteSessionMismatchText,
  quoteSyncSessionText,
} from './quoteSession';
import type { Holding } from './types';

describe('quote session presentation', () => {
  it.each([
    ['pre', '盘前'],
    ['regular', '盘中'],
    ['post', '盘后'],
    ['overnight', '夜盘'],
  ])('maps %s to %s with the ET quote time', (session, label) => {
    expect(formatPriceSession(session, '2026-07-23T13:20:00Z')).toBe(`${label} 09:20 ET`);
  });

  it('does not render a badge for a legacy quote without session metadata', () => {
    expect(formatPriceSession(undefined, '2026-07-23T13:20:00Z')).toBe('');
  });

  it('renders an honest previous-close sentence for a closed quote without a session badge', () => {
    expect(closedQuoteText('closed', 390.34)).toBe('休市 · 上一交易日收盘价 $390.34');
    expect(formatPriceSession('closed', '2026-07-25T14:00:00Z')).toBe('');
    expect(closedQuoteText('closed', Number.NaN)).toBe('');
  });

  it('explains when the quant session and current website quote disagree', () => {
    expect(quoteSessionMismatchText(
      'regular',
      { session: 'pre', priceTime: '2026-07-23T13:20:00Z' },
    )).toBe('量化快照取价为盘中，当前行情为盘前；回撤百分比基于量化取价计算。');
  });

  it('adds the current session to the summary sync text', () => {
    const holdings = [{
      quote: {
        session: 'post',
        priceTime: '2026-07-23T20:30:00Z',
      },
    }] as Holding[];

    expect(quoteSyncSessionText(holdings)).toBe('行情时段：盘后 16:30 ET');
  });
});
