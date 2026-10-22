import { describe, expect, it } from 'vitest';
import {
  OVERNIGHT_NO_QUOTE_NOTE, QUOTE_STALE_MS, feedOutageReading, markQuoteFreshness, pickOvernightQuote,
} from './quote-freshness.mjs';

const NOW = new Date('2026-10-22T07:02:00.000Z'); // 美东 10-22 03:02，夜盘

describe('价格新鲜度', () => {
  it('交易时段内超过 15 分钟没更新就算不新鲜，isRealtime 改成 false', () => {
    expect(QUOTE_STALE_MS).toBe(15 * 60 * 1000);

    const stale = markQuoteFreshness(
      { symbol: 'QQQ', price: 719.42, priceTime: '2026-10-21T23:59:52.000Z', isRealtime: true },
      { now: NOW, session: 'overnight' },
    );

    expect(stale).toMatchObject({ isRealtime: false, stale: true });
    expect(stale.price_age_minutes).toBe(422);
    expect(stale.stale_note).toBe('数据停在 19:59');
  });

  it('刚更新过的照常算实时', () => {
    const fresh = markQuoteFreshness(
      { symbol: 'QQQ', price: 725.2, priceTime: '2026-10-22T07:01:41.000Z', isRealtime: true },
      { now: NOW, session: 'overnight' },
    );

    expect(fresh).toMatchObject({ isRealtime: true, stale: false, price_age_minutes: 0 });
    expect(fresh.stale_note).toBeNull();
  });

  it('休市时不判新鲜度：价格本来就不动', () => {
    const closed = markQuoteFreshness(
      { symbol: 'QQQ', price: 719.42, priceTime: '2026-10-21T23:59:52.000Z', isRealtime: true },
      { now: NOW, session: 'closed' },
    );

    expect(closed.stale).toBe(false);
  });

  it('没有价格时间就不敢说实时', () => {
    const unknown = markQuoteFreshness(
      { symbol: 'QQQ', price: 725.2, priceTime: null, isRealtime: true },
      { now: NOW, session: 'overnight' },
    );

    expect(unknown).toMatchObject({ isRealtime: false, price_age_minutes: null });
  });
});

describe('夜盘取哪一份报价', () => {
  const pushed = { price: 725.2, priceTime: '2026-10-22T07:01:41.000Z', source: 'futu_opend' };
  const nasdaq = { price: 725.2, priceTime: null, source: 'nasdaq' };
  const yahoo = { price: 719.42, priceTime: '2026-10-21T23:59:52.000Z', source: 'proxy' };

  it('优先用富途推上来的夜盘价（有精确时间）', () => {
    expect(pickOvernightQuote({ pushed, nasdaq, yahoo, now: NOW })).toMatchObject({
      price: 725.2, source: 'futu_opend',
    });
  });

  it('富途那份过期了就退到 Nasdaq', () => {
    const old = { ...pushed, priceTime: '2026-10-22T06:00:00.000Z' };
    expect(pickOvernightQuote({ pushed: old, nasdaq, yahoo, now: NOW })).toMatchObject({ source: 'nasdaq' });
  });

  it('两个都没有时不沿用旧价格，标「夜盘无报价」', () => {
    const picked = pickOvernightQuote({ pushed: null, nasdaq: null, yahoo, now: NOW });

    expect(picked).toMatchObject({ price: null, stale: true, stale_note: OVERNIGHT_NO_QUOTE_NOTE });
    expect(OVERNIGHT_NO_QUOTE_NOTE).toBe('夜盘无报价');
  });

  it('Nasdaq 没给成交时刻：照实标出来，不假装是实时', () => {
    const picked = pickOvernightQuote({ pushed: null, nasdaq, yahoo, now: NOW });

    expect(picked).toMatchObject({ price: 725.2, source: 'nasdaq', price_time_known: false, isRealtime: false });
  });
});

describe('夜盘行情中断提醒', () => {
  it('交易时段里价格全都过期就写一条「❗ 夜盘行情中断」', () => {
    const reading = feedOutageReading({
      session: 'overnight',
      quotes: {
        QQQ: { price: 719.42, stale: true, stale_note: '数据停在 19:59' },
        TQQQ: { price: 69.19, stale: true, stale_note: '数据停在 19:59' },
      },
      now: NOW,
    });

    expect(reading).toMatchObject({ key: 'overnight-feed', state: 'triggered', category: 'system', icon: '❗' });
    expect(reading!.text).toContain('夜盘行情中断');
    expect(reading!.text).toContain('19:59');
  });

  it('有一半以上还新鲜就算正常，恢复时写「已恢复」', () => {
    const reading = feedOutageReading({
      session: 'overnight',
      quotes: {
        QQQ: { price: 725.2, stale: false },
        TQQQ: { price: 69.19, stale: true, stale_note: '数据停在 19:59' },
      },
      now: NOW,
    });

    expect(reading).toMatchObject({ state: 'normal', icon: '✅' });
    expect(reading!.text).toContain('已恢复');
  });

  it('休市和没有报价时不判断，免得刚启动就报警', () => {
    expect(feedOutageReading({ session: 'closed', quotes: { QQQ: { stale: true } }, now: NOW })).toBeNull();
    expect(feedOutageReading({ session: 'overnight', quotes: {}, now: NOW })).toBeNull();
  });
});
