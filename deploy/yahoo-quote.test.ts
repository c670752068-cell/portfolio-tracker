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
      previousClose: 397.75,
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
      previousClose: 397.75,
    }));
  });
});
