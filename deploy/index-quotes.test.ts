import { describe, expect, it, vi } from 'vitest';
import {
  INDEX_ITEMS, buildIndexPayload, createIndexQuotesCache, indexRefreshMs, indexSymbolsFor, parseIndexQuote,
} from './index-quotes.mjs';

const NOW = new Date('2026-10-21T16:26:52.000Z');

describe('三大指数：常规时段看指数，其余时段看期货', () => {
  it('三个标的和中文名', () => {
    expect(INDEX_ITEMS.map((item) => item.name)).toEqual(['纳斯达克', '标普500', '道琼斯']);
  });

  it('常规时段取指数代码', () => {
    expect(indexSymbolsFor('regular')).toEqual([
      { key: 'nasdaq', name: '纳斯达克', symbol: '^IXIC', futures: false },
      { key: 'sp500', name: '标普500', symbol: '^GSPC', futures: false },
      { key: 'dow', name: '道琼斯', symbol: '^DJI', futures: false },
    ]);
  });

  it.each(['pre', 'post', 'overnight', 'closed'])('%s 取期货代码并改名', (session) => {
    expect(indexSymbolsFor(session)).toEqual([
      { key: 'nasdaq', name: '纳指期货', symbol: 'NQ=F', futures: true },
      { key: 'sp500', name: '标普期货', symbol: 'ES=F', futures: true },
      { key: 'dow', name: '道指期货', symbol: 'YM=F', futures: true },
    ]);
  });

  it('刷新节奏：常规时段 10 秒，其余 30 秒', () => {
    expect(indexRefreshMs('regular')).toBe(10_000);
    expect(indexRefreshMs('post')).toBe(30_000);
    expect(indexRefreshMs('closed')).toBe(30_000);
  });
});

describe('从 Yahoo 的返回里取指数/期货报价', () => {
  const payload = (meta: Record<string, unknown>) => ({ chart: { result: [{ meta }] } });

  it('涨跌幅一律对 chartPreviousClose 算：期货用的是上一个结算价', () => {
    // 线上实测（2026-10-21 盘中）：NQ=F 现价 30019.75、上一结算 29675.25
    const quote = parseIndexQuote(payload({
      regularMarketPrice: 30019.75, chartPreviousClose: 29675.25, regularMarketTime: 1761063411,
    }));

    expect(quote).toMatchObject({ price: 30019.75, previousClose: 29675.25 });
    expect(quote!.quoteTime).toBe(new Date(1761063411_000).toISOString());
  });

  it('没有价格就返回空，不编数字', () => {
    expect(parseIndexQuote(payload({ chartPreviousClose: 100 }))).toBeNull();
    expect(parseIndexQuote({})).toBeNull();
  });
});

describe('组装返回给网页的数据', () => {
  const quotes = {
    '^IXIC': { price: 26687.643, previousClose: 26424.816, quoteTime: '2026-10-21T16:26:50.000Z' },
    '^GSPC': { price: 7748.39, previousClose: 7712.57, quoteTime: '2026-10-21T16:26:52.000Z' },
    '^DJI': { price: 52644.85, previousClose: 52495.88, quoteTime: '2026-10-21T16:26:51.000Z' },
  };

  it('算涨跌幅、标注行情时间和延迟', () => {
    const payload = buildIndexPayload({ session: 'regular', quotes, now: NOW });

    expect(payload.session).toBe('regular');
    expect(payload.refresh_ms).toBe(10_000);
    expect(payload.items[0]).toMatchObject({
      key: 'nasdaq', name: '纳斯达克', symbol: '^IXIC', futures: false, price: 26687.643,
      delay_minutes: 0,
    });
    expect(payload.items[0].change_percent).toBeCloseTo(0.9947, 3);
    expect(payload.items[0].quote_time).toBe('2026-10-21T16:26:50.000Z');
  });

  it('期货的延迟照实算出来', () => {
    const payload = buildIndexPayload({
      session: 'post',
      quotes: { 'NQ=F': { price: 30019.75, previousClose: 29675.25, quoteTime: '2026-10-21T16:16:51.000Z' } },
      now: NOW,
    });

    expect(payload.items[0]).toMatchObject({ key: 'nasdaq', name: '纳指期货', futures: true, delay_minutes: 10 });
  });

  it('取不到的留空，不编数字', () => {
    const payload = buildIndexPayload({ session: 'regular', quotes: {}, now: NOW });

    expect(payload.items).toHaveLength(3);
    for (const item of payload.items) {
      expect(item.price).toBeNull();
      expect(item.change_percent).toBeNull();
      expect(item.quote_time).toBeNull();
      expect(item.delay_minutes).toBeNull();
    }
  });

  it('没有昨收就算不出涨跌幅', () => {
    const payload = buildIndexPayload({
      session: 'regular', quotes: { '^IXIC': { price: 100, previousClose: null, quoteTime: null } }, now: NOW,
    });
    expect(payload.items[0].price).toBe(100);
    expect(payload.items[0].change_percent).toBeNull();
  });
});

describe('服务器统一取数并缓存', () => {
  it('缓存期内多次请求只打一次数据源', async () => {
    const fetchQuote = vi.fn(async (symbol: string) => ({ price: 1, previousClose: 1, quoteTime: null, symbol }));
    const cache = createIndexQuotesCache({ fetchQuote, now: () => NOW });

    await cache.read('regular');
    await cache.read('regular');
    await cache.read('regular');

    expect(fetchQuote).toHaveBeenCalledTimes(4); // 三个指数 + 黄金各一次
  });

  it('过了刷新间隔才再取一次', async () => {
    const fetchQuote = vi.fn(async () => ({ price: 1, previousClose: 1, quoteTime: null }));
    let clock = +NOW;
    const cache = createIndexQuotesCache({ fetchQuote, now: () => new Date(clock) });

    await cache.read('regular');
    clock += 5_000;
    await cache.read('regular');
    expect(fetchQuote).toHaveBeenCalledTimes(4);

    clock += 10_000;
    await cache.read('regular');
    expect(fetchQuote).toHaveBeenCalledTimes(8);
  });

  it('换了时段（指数↔期货）立刻重新取', async () => {
    const fetchQuote = vi.fn(async () => ({ price: 1, previousClose: 1, quoteTime: null }));
    const cache = createIndexQuotesCache({ fetchQuote, now: () => NOW });

    await cache.read('regular');
    await cache.read('post');

    expect(fetchQuote).toHaveBeenCalledTimes(8);
  });

  it('某个标的取数失败时其他照常返回，不整张卡片变空', async () => {
    const fetchQuote = vi.fn(async (symbol: string) => {
      if (symbol === '^DJI') throw new Error('upstream down');
      return { price: 10, previousClose: 9, quoteTime: null };
    });
    const cache = createIndexQuotesCache({ fetchQuote, now: () => NOW });
    const payload = await cache.read('regular');

    expect(payload.items.find((item) => item.key === 'dow')!.price).toBeNull();
    expect(payload.items.find((item) => item.key === 'nasdaq')!.price).toBe(10);
  });

  it('期货取数失败时沿用上一次成功的价格，延迟分钟按那笔报价的时间照实算', async () => {
    let clock = +NOW;
    let failing = false;
    const fetchQuote = vi.fn(async (symbol: string) => {
      if (failing && symbol === 'ES=F') throw new Error('timeout');
      if (failing && symbol === 'YM=F') return null;
      return { price: 200, previousClose: 100, quoteTime: new Date(clock - 10 * 60_000).toISOString() };
    });
    const cache = createIndexQuotesCache({ fetchQuote, now: () => new Date(clock) });
    await cache.read('overnight');

    clock += 60_000;
    failing = true;
    const payload = await cache.read('overnight');
    const row = (key: string) => payload.items.find((item) => item.key === key)!;

    expect(row('sp500')).toMatchObject({ price: 200, change_percent: 100, delay_minutes: 11 });
    expect(row('dow')).toMatchObject({ price: 200, change_percent: 100, delay_minutes: 11 });
    expect(row('nasdaq')).toMatchObject({ price: 200, delay_minutes: 10 });
  });

  it('期货从没取到过时仍显示暂无，不编数', async () => {
    const fetchQuote = vi.fn(async (symbol: string) => {
      if (symbol === 'ES=F') throw new Error('timeout');
      return { price: 1, previousClose: 1, quoteTime: null };
    });
    const cache = createIndexQuotesCache({ fetchQuote, now: () => NOW });
    const payload = await cache.read('overnight');

    expect(payload.items.find((item) => item.key === 'sp500')!.price).toBeNull();
  });
});

describe('黄金：所有时段都看 COMEX 黄金期货（GC=F）', () => {
  it('单独给一行 gold，涨跌幅对上一个结算价，延迟照实算', () => {
    // 线上实测（2026-11-04 夜盘）：GC=F 3968.1、上一结算 3940.4
    const payload = buildIndexPayload({
      session: 'regular',
      quotes: { 'GC=F': { price: 3968.1, previousClose: 3940.4, quoteTime: '2026-10-21T16:16:52.000Z' } },
      now: NOW,
    });

    expect(payload.items).toHaveLength(3);
    expect(payload.gold).toMatchObject({
      key: 'gold', name: '黄金期货', symbol: 'GC=F', futures: true, price: 3968.1, delay_minutes: 10,
    });
    expect(payload.gold.change_percent).toBeCloseTo(0.703, 2);
  });

  it('取不到就留空，不编数', () => {
    const payload = buildIndexPayload({ session: 'overnight', quotes: {}, now: NOW });

    expect(payload.gold).toMatchObject({ key: 'gold', price: null, change_percent: null, delay_minutes: null });
  });

  it.each(['regular', 'overnight'])('%s 时段都去取 GC=F', async (session) => {
    const fetchQuote = vi.fn(async () => ({ price: 1, previousClose: 1, quoteTime: null }));
    const cache = createIndexQuotesCache({ fetchQuote, now: () => NOW });

    await cache.read(session);

    expect(fetchQuote).toHaveBeenCalledWith('GC=F');
  });

  it('黄金取数失败时沿用上一次成功的价格', async () => {
    let clock = +NOW;
    let failing = false;
    const fetchQuote = vi.fn(async (symbol: string) => {
      if (failing && symbol === 'GC=F') throw new Error('timeout');
      return { price: 3968.1, previousClose: 3940.4, quoteTime: new Date(clock - 10 * 60_000).toISOString() };
    });
    const cache = createIndexQuotesCache({ fetchQuote, now: () => new Date(clock) });
    await cache.read('regular');

    clock += 60_000;
    failing = true;
    const payload = await cache.read('regular');

    expect(payload.gold).toMatchObject({ price: 3968.1, delay_minutes: 11 });
  });
});
