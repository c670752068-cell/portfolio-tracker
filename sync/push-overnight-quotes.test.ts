import { describe, expect, it } from 'vitest';
import { decisionSymbolsFrom, overnightSymbols, parseOpendOutput, shouldPushNow } from './push-overnight-quotes.mjs';

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
  it('SPY、DIA 也推夜盘价：日志页距前高要用夜盘价算，不能等盘中', () => {
    expect(overnightSymbols({})).toEqual(expect.arrayContaining(['QQQ', 'SPY', 'DIA']));
  });

  it('决策页的 43 个标的都推夜盘价（VOO、AAPL 这些以前漏了，夜盘预览拿的是收盘价）', () => {
    const decision = decisionSymbolsFrom({ symbols: Object.fromEntries([
      'AAPL', 'AMZN', 'AVGO', 'AVL', 'COPX', 'DIA', 'FAS', 'FNGS', 'FNGU', 'GDX', 'GLDM', 'GOOG', 'IGV', 'KO', 'MAGS',
      'MCD', 'META', 'MSFT', 'MU', 'NAIL', 'NDX', 'NKE', 'NVDA', 'PDD', 'QQQ', 'QQQM', 'SMH', 'SOX', 'SOXL', 'SOXX',
      'SPCX', 'SPX', 'SPY', 'TECL', 'TQQQ', 'TSLA', 'TSLL', 'TSM', 'UDOW', 'VOO', 'WMT', 'XLF', 'XLK',
    ].map((symbol) => [symbol, {}])) });
    const symbols = overnightSymbols({ held: ['SGOV', 'PLTR'], watch: decision });

    expect(symbols).toEqual(expect.arrayContaining(['VOO', 'AAPL', 'MSFT', 'KO', 'XLK', 'MAGS', 'IGV', 'COPX', 'SGOV', 'PLTR']));
    expect(symbols).toHaveLength(45);
  });

  it('决策页名单读不到或格式不对时给空名单', () => {
    expect(decisionSymbolsFrom(null)).toEqual([]);
    expect(decisionSymbolsFrom({ symbols: 'x' })).toEqual([]);
  });

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
    // 线上实测 2026-11-03 夜盘：last_price 是当天常规收盘 685.28，夜盘价在 overnight_price（671.44，-2.0%）
    const parsed = parseOpendOutput(JSON.stringify({
      quotes: [
        { code: 'US.QQQ', last_price: 685.28, prev_close_price: 681.09, overnight_price: 671.44, update_time: '2026-11-03 21:40:37.288' },
        { code: 'US.TQQQ', last_price: 72.61, prev_close_price: 70.41, overnight_price: 70.1, update_time: '2026-11-03 21:40:42.789' },
      ],
    }));

    expect(parsed).toHaveLength(2);
    // 夜盘价取 overnight_price，「昨收」是刚结束的那个常规交易日的收盘（last_price）
    expect(parsed[0]).toMatchObject({ symbol: 'QQQ', price: 671.44, previousClose: 685.28 });
    // 美东 21:40:37（冬令时）= UTC 次日 02:40:37
    expect(parsed[0].priceTime).toBe('2026-11-04T02:40:37.288Z');
  });

  it('没有夜盘价的标的不推，不拿常规收盘价冒充夜盘价', () => {
    expect(parseOpendOutput(JSON.stringify({
      quotes: [
        { code: 'US.SPY', last_price: 754.35, prev_close_price: 752.1, update_time: '2026-11-03 21:40:42.929' },
        { code: 'US.DIA', last_price: 517.06, prev_close_price: 519.34, overnight_price: 0, update_time: '2026-11-03 21:40:30.110' },
      ],
    }))).toEqual([]);
  });

  it('坏输出不抛错，返回空', () => {
    expect(parseOpendOutput('不是 JSON')).toEqual([]);
    expect(parseOpendOutput(JSON.stringify({ quotes: 'x' }))).toEqual([]);
    expect(parseOpendOutput(JSON.stringify({ quotes: [{ code: 'US.QQQ' }] }))).toEqual([]);
  });
});
