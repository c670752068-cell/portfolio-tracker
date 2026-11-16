import { describe, expect, it, vi } from 'vitest';
import {
  VOLATILITY_ITEMS, buildVolatilityPayload, cboeHistoryUrl, channelFromDashboard, createVolatilityCache,
  createVolatilityRoute, parseCboeHistory, withLatestPoint,
} from './volatility-index.mjs';

const NOW = new Date('2026-11-05T21:30:00.000Z');
const row = (date: string, close: unknown) => ({ date, volume: '0.0', open: '1', high: '1', low: '1', close });

describe('恐慌指数：三个标的', () => {
  it('VXSMH 排第一，现价走 Yahoo，日线走 Cboe', () => {
    expect(VOLATILITY_ITEMS.map((item) => item.key)).toEqual(['VXSMH', 'VXN', 'VIX']);
    expect(VOLATILITY_ITEMS[0]).toMatchObject({ name: '半导体', symbol: '^VXSMH', cboe: '_VXSMH' });
    expect(cboeHistoryUrl(VOLATILITY_ITEMS[0])).toBe(
      'https://cdn-api.cboe.com/api/global/delayed_quotes/charts/historical/_VXSMH.json',
    );
  });
});

describe('Cboe 日线', () => {
  it('只留最近一年，收盘价转成数字', () => {
    const series = parseCboeHistory({
      data: [row('2025-09-16', '31.440000'), row('2025-11-05', '30.000000'), row('2026-11-05', '65.890000')],
    }, NOW);

    expect(series).toEqual([{ date: '2025-11-05', close: 30 }, { date: '2026-11-05', close: 65.89 }]);
  });

  it('坏行丢掉，返回坏了给空数组，不编数', () => {
    expect(parseCboeHistory({
      data: [row('2026-11-01', 'abc'), row('2026-11-02', '0'), row('', '10'), row('2026-11-03', '20')],
    }, NOW)).toEqual([{ date: '2026-11-03', close: 20 }]);
    expect(parseCboeHistory({}, NOW)).toEqual([]);
    expect(parseCboeHistory(null, NOW)).toEqual([]);
  });
});

describe('日线接上今天的现价', () => {
  const series = [{ date: '2026-11-04', close: 45.82 }];

  it('现价是更新的一天就补一个点，不改原数组', () => {
    const next = withLatestPoint(series, { price: 65.89, quoteTime: '2026-11-05T20:00:00.000Z' });

    expect(next).toEqual([...series, { date: '2026-11-05', close: 65.89 }]);
    expect(series).toHaveLength(1);
  });

  it('同一天不补', () => {
    expect(withLatestPoint(series, { price: 50, quoteTime: '2026-11-04T20:00:00.000Z' })).toEqual(series);
  });

  it('日期按美东算：美东 11-04 晚上 8 点已是 UTC 11-05，也算同一天', () => {
    expect(withLatestPoint(series, { price: 50, quoteTime: '2026-11-05T01:00:00.000Z' })).toEqual(series);
  });

  it('没有现价或没有时间就不补', () => {
    expect(withLatestPoint(series, null)).toEqual(series);
    expect(withLatestPoint(series, { price: null, quoteTime: '2026-11-05T20:00:00.000Z' })).toEqual(series);
    expect(withLatestPoint(series, { price: 50, quoteTime: null })).toEqual(series);
  });
});

describe('组装返回给网页的数据', () => {
  it('算涨跌幅，带上日线', () => {
    const payload = buildVolatilityPayload({
      quotes: { VXSMH: { price: 65.89, previousClose: 45.82, quoteTime: '2026-11-05T21:02:02.000Z' } },
      history: { VXSMH: [{ date: '2026-11-04', close: 45.82 }, { date: '2026-11-05', close: 65.89 }] },
      now: NOW,
    });
    const item = payload.items[0];

    expect(payload.time).toBe(NOW.toISOString());
    expect(item).toMatchObject({
      key: 'VXSMH', name: '半导体', symbol: '^VXSMH', price: 65.89, quote_time: '2026-11-05T21:02:02.000Z',
    });
    expect(item.change_percent).toBeCloseTo(43.8, 1);
    expect(item.series).toHaveLength(2);
  });

  it('取不到的留空，不编数', () => {
    const payload = buildVolatilityPayload({ quotes: {}, history: {}, now: NOW });

    expect(payload.items).toHaveLength(3);
    for (const item of payload.items) {
      expect(item).toMatchObject({ price: null, change_percent: null, quote_time: null, series: [] });
    }
  });
});

describe('服务器统一取数并缓存', () => {
  const setup = () => {
    let clock = +NOW;
    const fetchQuote = vi.fn(async () => ({ price: 20, previousClose: 10, quoteTime: new Date(clock).toISOString() }));
    const fetchHistory = vi.fn(async () => [{ date: '2026-11-04', close: 10 }]);
    const cache = createVolatilityCache({ fetchQuote, fetchHistory, now: () => new Date(clock) });
    return { cache, fetchQuote, fetchHistory, advance: (ms: number) => { clock += ms; } };
  };

  it('60 秒内多次请求只取一次', async () => {
    const { cache, fetchQuote, fetchHistory } = setup();

    await cache.read();
    await cache.read();

    expect(fetchQuote).toHaveBeenCalledTimes(3);
    expect(fetchHistory).toHaveBeenCalledTimes(3);
  });

  it('同时来的请求共用一次取数', async () => {
    const { cache, fetchQuote, fetchHistory } = setup();

    await Promise.all([cache.read(), cache.read(), cache.read()]);

    expect(fetchQuote).toHaveBeenCalledTimes(3);
    expect(fetchHistory).toHaveBeenCalledTimes(3);
  });

  it('过 60 秒只重取现价，日线 6 小时才重取', async () => {
    const { cache, fetchQuote, fetchHistory, advance } = setup();
    await cache.read();

    advance(60_000);
    await cache.read();
    expect(fetchQuote).toHaveBeenCalledTimes(6);
    expect(fetchHistory).toHaveBeenCalledTimes(3);

    advance(6 * 3_600_000);
    await cache.read();
    expect(fetchHistory).toHaveBeenCalledTimes(6);
  });

  it('现价取数失败沿用上一次成功的', async () => {
    let clock = +NOW;
    let failing = false;
    const fetchQuote = vi.fn(async () => {
      if (failing) throw new Error('timeout');
      return { price: 20, previousClose: 10, quoteTime: '2026-11-05T21:00:00.000Z' };
    });
    const cache = createVolatilityCache({
      fetchQuote, fetchHistory: async () => [], now: () => new Date(clock),
    });
    await cache.read();

    failing = true;
    clock += 60_000;
    const payload = await cache.read();

    expect(payload.items[0]).toMatchObject({ price: 20, change_percent: 100 });
  });

  it('日线取数失败沿用旧的，下一轮就重试，不等 6 小时', async () => {
    let clock = +NOW;
    let failing = false;
    const fetchHistory = vi.fn(async () => {
      if (failing) throw new Error('timeout');
      return [{ date: '2026-11-04', close: 10 }];
    });
    const cache = createVolatilityCache({ fetchQuote: async () => null, fetchHistory, now: () => new Date(clock) });
    await cache.read();

    failing = true;
    clock += 6 * 3_600_000;
    const stale = await cache.read();
    expect(stale.items[0].series).toEqual([{ date: '2026-11-04', close: 10 }]);
    expect(fetchHistory).toHaveBeenCalledTimes(6);

    failing = false;
    clock += 60_000;
    await cache.read();
    expect(fetchHistory).toHaveBeenCalledTimes(9);
  });

  it('某个标的失败不影响另外两个', async () => {
    const cache = createVolatilityCache({
      fetchQuote: async (symbol: string) => {
        if (symbol === '^VXN') throw new Error('down');
        return { price: 20, previousClose: 10, quoteTime: null };
      },
      fetchHistory: async () => [],
      now: () => NOW,
    });
    const payload = await cache.read();
    const price = (key: string) => payload.items.find((item) => item.key === key)!.price;

    expect(price('VXN')).toBeNull();
    expect(price('VXSMH')).toBe(20);
  });

  it('日线末尾接上今天的现价', async () => {
    const cache = createVolatilityCache({
      fetchQuote: async () => ({ price: 20, previousClose: 10, quoteTime: '2026-11-05T20:00:00.000Z' }),
      fetchHistory: async () => [{ date: '2026-11-04', close: 10 }],
      now: () => NOW,
    });
    const payload = await cache.read();

    expect(payload.items[0].series.at(-1)).toEqual({ date: '2026-11-05', close: 20 });
  });
});

describe('只读路由', () => {
  const setup = () => {
    const sendJson = vi.fn();
    const route = createVolatilityRoute({ cache: { read: async () => ({ items: [] }) }, sendJson });
    return { route, sendJson };
  };

  it('GET 返回数据', async () => {
    const { route, sendJson } = setup();
    const res = {};

    await expect(route(new URL('http://x/api/portfolio/volatility'), { method: 'GET' }, res)).resolves.toBe(true);
    expect(sendJson).toHaveBeenCalledWith(res, 200, { volatility: { items: [] } });
  });

  it('其他方法 405，其他路径不处理', async () => {
    const { route, sendJson } = setup();

    await route(new URL('http://x/api/portfolio/volatility'), { method: 'POST' }, {});
    expect(sendJson.mock.calls[0][1]).toBe(405);
    await expect(route(new URL('http://x/api/other'), { method: 'GET' }, {})).resolves.toBe(false);
  });
});

describe('对应 ETF 的 ±1.5σ 通道', () => {
  it('VXSMH → SMH，VXN → QQQ，VIX → SPY', () => {
    expect(VOLATILITY_ITEMS.map((item) => item.underlying)).toEqual(['SMH', 'QQQ', 'SPY']);
  });

  it('从趋势图日线取收盘、下沿、Z；缺 Z 的点丢掉', () => {
    expect(channelFromDashboard({ dashboard: { series: [
      { date: '2026-11-04', close: 300, zscore200: -0.4, band200: [280, 360] },
      { date: '2026-11-05', close: 301, zscore200: null, band200: null },
      { date: '2026-11-06', close: 270, zscore200: -1.8, band200: [279, 359], is_partial: true },
    ] } })).toEqual([
      { date: '2026-11-04', close: 300, lower: 280, z: -0.4, partial: false },
      { date: '2026-11-06', close: 270, lower: 279, z: -1.8, partial: true },
    ]);
    expect(channelFromDashboard(null)).toEqual([]);
  });

  it('日线点挂上同一天 ETF 的 Z，并给出 ETF 最新位置', () => {
    const payload = buildVolatilityPayload({
      history: { VXSMH: [{ date: '2026-06-10', close: 62 }, { date: '2026-11-05', close: 51 }] },
      channels: { VXSMH: [
        { date: '2026-06-10', close: 330, lower: 250, z: 1.3, partial: false },
        { date: '2026-11-05', close: 300, lower: 280, z: -0.4, partial: false },
      ] },
      now: NOW,
    });
    const item = payload.items[0];

    expect(item.series).toEqual([{ date: '2026-06-10', close: 62, z: 1.3 }, { date: '2026-11-05', close: 51, z: -0.4 }]);
    expect(item.underlying).toEqual({ symbol: 'SMH', as_of: '2026-11-05', close: 300, lower_band: 280, z_score: -0.4, partial: false });
    expect(payload.items[1].underlying).toMatchObject({ symbol: 'QQQ', z_score: null });
  });

  it('通道取数失败不影响恐慌指数本身，沿用上一次成功的', async () => {
    const channel = [{ date: '2026-11-05', close: 300, lower: 280, z: -0.4, partial: false }];
    let fail = false;
    let at = +NOW;
    const cache = createVolatilityCache({
      fetchQuote: async () => ({ price: 50, previousClose: 49, quoteTime: '2026-11-05T21:00:00.000Z' }),
      fetchHistory: async () => [{ date: '2026-11-05', close: 50 }],
      fetchChannel: async () => { if (fail) throw new Error('down'); return channel; },
      now: () => new Date(at),
    });

    expect((await cache.read()).items[0].underlying.z_score).toBe(-0.4);
    fail = true;
    at += 120_000;
    const next = await cache.read();
    expect(next.items[0].price).toBe(50);
    expect(next.items[0].underlying.z_score).toBe(-0.4);
  });
});
