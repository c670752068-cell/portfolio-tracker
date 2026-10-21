import { describe, expect, it } from 'vitest';

import { buildYahooChartUrl, parseYahooChartQuote } from './yahoo-quote.mjs';

function chartPayload({
  timestamps = [1753276500, 1753276800],
  closes = [387.5, 388],
}: {
  timestamps?: number[];
  closes?: Array<number | null>;
} = {}) {
  return {
    chart: {
      result: [{
        meta: {
          currency: 'USD',
          chartPreviousClose: 397.75,
          regularMarketPrice: 390.34,
          regularMarketTime: 1753300800,
          currentTradingPeriod: {
            pre: { start: 1753257600, end: 1753277400 },
            regular: { start: 1753277400, end: 1753300800 },
            post: { start: 1753300800, end: 1753315200 },
          },
        },
        timestamp: timestamps,
        indicators: { quote: [{ close: closes }] },
      }],
    },
  };
}

describe('Yahoo full-session quote parsing', () => {
  it('requests five-minute pre/post data for one day', () => {
    expect(buildYahooChartUrl('BRK.B')).toBe(
      'https://query1.finance.yahoo.com/v8/finance/chart/BRK-B?range=1d&interval=5m&includePrePost=true',
    );
  });

  it('uses the last aligned minute close and its premarket timestamp', () => {
    expect(parseYahooChartQuote('MSFT', chartPayload())).toEqual(expect.objectContaining({
      symbol: 'MSFT',
      price: 388,
      session: 'pre',
      priceTime: '2025-07-23T13:20:00.000Z',
      regularMarketPrice: 390.34,
      // 盘前的参考价是最近一个常规收盘价（390.34），不是 chartPreviousClose 指的再前一天
      previousClose: 390.34,
    }));
  });

  it('skips null values at the tail without losing timestamp alignment', () => {
    const payload = chartPayload({
      timestamps: [1753276500, 1753276800, 1753277100],
      closes: [387.5, 388, null],
    });

    const quote = parseYahooChartQuote('MSFT', payload);

    expect(quote.price).toBe(388);
    expect(quote.priceTime).toBe('2025-07-23T13:20:00.000Z');
  });

  it('marks an empty minute series closed and exposes the previous regular close honestly', () => {
    const quote = parseYahooChartQuote('MSFT', chartPayload({ timestamps: [], closes: [] }));

    expect(quote).toEqual(expect.objectContaining({
      price: 390.34,
      session: 'closed',
      regularMarketPrice: 390.34,
      // 休市时现价就是最近一个常规收盘价，参考价同样是它：涨跌 0%，不是凭空的 -1.9%
      previousClose: 390.34,
    }));
  });
});

describe('非常规时段的「较昨收」参考价', () => {
  // 线上实测（2026-10-20 盘后）：chartPreviousClose 是上一个交易日的再前一天，
  // regularMarketPrice 才是最近一个已完成常规交易日的收盘价。
  // SOXL 104.80：拿 98.65 算是 +6.2%，拿 97.55 算才是真实的 +7.4%。
  const payload = (session: 'pre' | 'regular' | 'post', price: number) => ({
    chart: {
      result: [{
        meta: {
          currency: 'USD',
          chartPreviousClose: 98.65,
          regularMarketPrice: 97.55,
          regularMarketTime: 1761000000,
          currentTradingPeriod: {
            pre: { start: 1760947200, end: 1760967000 },
            regular: { start: 1760967000, end: 1760990400 },
            post: { start: 1760990400, end: 1761004800 },
          },
        },
        timestamp: [session === 'pre' ? 1760950000 : session === 'regular' ? 1760970000 : 1760992000],
        indicators: { quote: [{ close: [price] }] },
      }],
    },
  });

  it('盘后用最近一个常规收盘价当参考，不用再前一天的', () => {
    const quote = parseYahooChartQuote('SOXL', payload('post', 104.8));

    expect(quote.session).toBe('post');
    expect(quote.previousClose).toBe(97.55);
    expect(quote.changePercent! * 100).toBeCloseTo(7.43, 2);
  });

  it('盘前同样用最近一个常规收盘价', () => {
    const quote = parseYahooChartQuote('SOXL', payload('pre', 100.6));

    expect(quote.session).toBe('pre');
    expect(quote.previousClose).toBe(97.55);
    expect(quote.changePercent! * 100).toBeCloseTo(3.13, 2);
  });

  it('盘中照旧用 chartPreviousClose，盘中的数字本来就是对的', () => {
    const quote = parseYahooChartQuote('SOXL', payload('regular', 100.6));

    expect(quote.session).toBe('regular');
    expect(quote.previousClose).toBe(98.65);
  });

  it('没有 regularMarketPrice 时退回 chartPreviousClose，不编数字', () => {
    const raw = payload('post', 104.8);
    delete (raw.chart.result[0].meta as { regularMarketPrice?: number }).regularMarketPrice;

    expect(parseYahooChartQuote('SOXL', raw).previousClose).toBe(98.65);
  });
});

