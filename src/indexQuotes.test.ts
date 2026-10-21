import { describe, expect, it } from 'vitest';
import {
  INDEX_STALE_MS, changeText, delayText, indexDataState, parseIndexQuotes,
} from './indexQuotes';

const payload = {
  indexes: {
    version: 1,
    session: 'post',
    time: '2026-10-21T16:26:52.000Z',
    refresh_ms: 30000,
    source: 'Yahoo Finance',
    items: [
      { key: 'nasdaq', name: '纳指期货', symbol: 'NQ=F', futures: true, price: 30019.75, change_percent: 1.161, quote_time: '2026-10-21T16:16:51.000Z', delay_minutes: 10 },
      { key: 'sp500', name: '标普期货', symbol: 'ES=F', futures: true, price: 7794, change_percent: 0.5, quote_time: '2026-10-21T16:16:50.000Z', delay_minutes: 10 },
      { key: 'dow', name: '道指期货', symbol: 'YM=F', futures: true, price: null, change_percent: null, quote_time: null, delay_minutes: null },
    ],
  },
};

describe('三大指数卡片的数据', () => {
  it('解析接口返回', () => {
    const parsed = parseIndexQuotes(payload);

    expect(parsed).toMatchObject({ session: 'post', refreshMs: 30000, source: 'Yahoo Finance' });
    expect(parsed.items).toHaveLength(3);
    expect(parsed.items[0]).toMatchObject({ name: '纳指期货', futures: true, delayMinutes: 10 });
  });

  it('返回坏了也给一个空结构，不让页面炸', () => {
    expect(parseIndexQuotes(null).items).toEqual([]);
    expect(parseIndexQuotes({ indexes: { items: 'x' } }).items).toEqual([]);
    expect(parseIndexQuotes(null).refreshMs).toBe(30000);
  });

  it('涨跌幅带正负号，取不到写「暂无」', () => {
    expect(changeText(1.161)).toBe('+1.16%');
    expect(changeText(-0.5)).toBe('-0.50%');
    expect(changeText(null)).toBe('暂无');
  });

  it('延迟文案：没有延迟就不写，有就写明几分钟', () => {
    expect(delayText(0)).toBe('');
    expect(delayText(10)).toBe('延迟 10 分钟');
    expect(delayText(null)).toBe('');
  });

  it('超过 2 分钟没拿到新数据就算「数据延迟」', () => {
    const at = Date.parse('2026-10-21T16:26:52.000Z');

    expect(INDEX_STALE_MS).toBe(120_000);
    expect(indexDataState(at, at + 60_000)).toBe('live');
    expect(indexDataState(at, at + 130_000)).toBe('stale');
    expect(indexDataState(null, at)).toBe('stale');
  });
});
