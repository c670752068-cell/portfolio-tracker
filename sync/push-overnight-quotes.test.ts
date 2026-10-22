import { describe, expect, it } from 'vitest';
import { overnightSymbols, parseOpendOutput, shouldPushNow } from './push-overnight-quotes.mjs';

describe('夜盘推送：什么时候推', () => {
  it('只在夜盘（美东 20:00–04:00）推，别的时段不打扰 OpenD', () => {
    // 美东 2026-10-21 21:30 → 夜盘
    expect(shouldPushNow(new Date('2026-10-22T01:30:00.000Z'))).toBe(true);
    // 美东 03:30 → 还是夜盘
    expect(shouldPushNow(new Date('2026-10-22T07:30:00.000Z'))).toBe(true);
    // 美东 10:00 → 常规时段
    expect(shouldPushNow(new Date('2026-10-22T14:00:00.000Z'))).toBe(false);
    // 美东 18:00 → 盘后
    expect(shouldPushNow(new Date('2026-10-22T22:00:00.000Z'))).toBe(false);
  });
});

describe('夜盘推送：推哪些标的', () => {
  it('固定几个指数 ETF 加上持仓和观察标的，去重并限量', () => {
    const symbols = overnightSymbols({
      held: ['TQQQ', 'tsll', 'US.SOXL'],
      watch: ['NVDA', 'QQQ'],
    });

    expect(symbols.slice(0, 3)).toEqual(['QQQ', 'QQQM', 'TQQQ']);
    expect(symbols).toContain('SOXL');
    expect(symbols).toContain('TSLL');
    expect(symbols).toContain('NVDA');
    expect(new Set(symbols).size).toBe(symbols.length);
    expect(symbols.length).toBeLessThanOrEqual(40);
  });
});

describe('夜盘推送：解析 OpenD 的输出', () => {
  it('把 python 打印的 JSON 变成上传格式，时间按美东补时区', () => {
    const parsed = parseOpendOutput(JSON.stringify({
      quotes: [
        { code: 'US.QQQ', last_price: 725.2, prev_close_price: 717.63, update_time: '2026-10-22 03:01:41.140' },
        { code: 'US.TQQQ', last_price: 72.61, prev_close_price: 70.41, update_time: '2026-10-22 03:01:42.789' },
      ],
    }));

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ symbol: 'QQQ', price: 725.2, previousClose: 717.63 });
    // 美东 03:01:41 = UTC 07:01:41
    expect(parsed[0].priceTime).toBe('2026-10-22T07:01:41.140Z');
  });

  it('坏输出不抛错，返回空', () => {
    expect(parseOpendOutput('不是 JSON')).toEqual([]);
    expect(parseOpendOutput(JSON.stringify({ quotes: 'x' }))).toEqual([]);
    expect(parseOpendOutput(JSON.stringify({ quotes: [{ code: 'US.QQQ' }] }))).toEqual([]);
  });
});
