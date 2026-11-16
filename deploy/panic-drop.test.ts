import { describe, expect, it, vi } from 'vitest';
import {
  PANIC_INDEXES, buildPanicDays, buildPanicPayload, createPanicCache, createPanicRoute, panicDailyUrl,
  panicWindow, parseDailyCloses,
} from './panic-drop.mjs';

const series = (rows: [string, number][]) => rows.map(([date, close]) => ({ date, close }));
// 2026-11-05 美东 09:30 开盘那根日线的时间
const BAR_1105 = Date.parse('2026-11-05T14:30:00.000Z') / 1000;
const BAR_1104 = Date.parse('2026-11-04T14:30:00.000Z') / 1000;
const yahoo = (stamps: number[], closes: (number | null)[]) => ({
  chart: { result: [{ timestamp: stamps, indicators: { quote: [{ close: closes }] } }] },
});

describe('标普、道指、纳指的日线', () => {
  it('取三大指数本身，不是 ETF', () => {
    expect(PANIC_INDEXES.map((item) => item.symbol)).toEqual(['^GSPC', '^DJI', '^IXIC']);
    expect(panicDailyUrl('^GSPC')).toBe('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=5y&interval=1d');
  });

  it('收盘后（美东 16:15 起）当天才算完整收盘', () => {
    const body = yahoo([BAR_1104, BAR_1105], [100, 95]);

    expect(parseDailyCloses(body, new Date('2026-11-05T20:00:00.000Z')).map((row) => row.date)).toEqual(['2026-11-04']);
    expect(parseDailyCloses(body, new Date('2026-11-05T21:15:00.000Z'))).toEqual(
      [{ date: '2026-11-04', close: 100 }, { date: '2026-11-05', close: 95 }],
    );
  });

  it('空值丢掉，返回坏了给空数组', () => {
    expect(parseDailyCloses(yahoo([BAR_1104, BAR_1105], [null, 95]), new Date('2026-11-06T20:00:00.000Z')).map((row) => row.date)).toEqual(['2026-11-05']);
    expect(parseDailyCloses({}, new Date())).toEqual([]);
    expect(parseDailyCloses(null, new Date())).toEqual([]);
  });
});

describe('恐慌性下跌的判定：标普收盘跌 3% 以上，且道指、纳指同跌', () => {
  const closes = (sp: number, dow: number, nasdaq: number) => ({
    sp500: series([['2026-11-04', 100], ['2026-11-05', 100 * (1 + sp / 100)]]),
    dow: series([['2026-11-04', 100], ['2026-11-05', 100 * (1 + dow / 100)]]),
    nasdaq: series([['2026-11-04', 100], ['2026-11-05', 100 * (1 + nasdaq / 100)]]),
  });

  it('11-05 实际数字：标普 -4.36、道指 -3.44、纳指 -5.52，算', () => {
    const [day] = buildPanicDays(closes(-4.36, -3.44, -5.52));

    expect(day.date).toBe('2026-11-05');
    expect(day.sp500).toBeCloseTo(-4.36, 2);
    expect(day.panic).toBe(true);
  });

  it('7-29 实际数字：标普 -1.52、道指 -2.19、纳指 -1.74，不算', () => {
    expect(buildPanicDays(closes(-1.52, -2.19, -1.74))[0].panic).toBe(false);
  });

  it('标普刚好 -3% 算，-2.99% 不算', () => {
    expect(buildPanicDays(closes(-3, -1, -1))[0].panic).toBe(true);
    expect(buildPanicDays(closes(-2.99, -1, -1))[0].panic).toBe(false);
  });

  it('道指或纳指有一个没跌就不算', () => {
    expect(buildPanicDays(closes(-4, 0.1, -1))[0].panic).toBe(false);
    expect(buildPanicDays(closes(-4, -1, 0.1))[0].panic).toBe(false);
  });

  it('只算三个指数都有数据的交易日', () => {
    const days = buildPanicDays({
      sp500: series([['2026-11-03', 100], ['2026-11-04', 90], ['2026-11-05', 80]]),
      dow: series([['2026-11-03', 100], ['2026-11-05', 80]]),
      nasdaq: series([['2026-11-03', 100], ['2026-11-04', 90], ['2026-11-05', 80]]),
    });

    expect(days.map((day) => day.date)).toEqual(['2026-11-05']);
    expect(days[0].sp500).toBeCloseTo(-20, 5);
  });
});

describe('恐慌窗口：恐慌后打开，标普收复跌前收盘就关', () => {
  const day = (date: string, close: number, previous: number, panic = false) => ({
    date, sp500: (close / previous - 1) * 100, dow: 0, nasdaq: 0, sp500_close: close, previous_close: previous, panic,
  });

  it('从没恐慌过：关着', () => {
    expect(panicWindow([day('2026-11-04', 100, 99)])).toMatchObject({ open: false, anchorClose: null, lastPanic: null });
  });

  it('恐慌后没收复：开着，记跌前收盘', () => {
    const window = panicWindow([day('2026-11-05', 95, 100, true), day('2026-11-06', 97, 95)]);

    expect(window).toMatchObject({ open: true, anchorClose: 100, recoveredOn: null });
    expect(window.lastPanic?.date).toBe('2026-11-05');
  });

  it('收盘收复跌前收盘：关上，记哪天收复', () => {
    const window = panicWindow([day('2026-11-05', 95, 100, true), day('2026-11-06', 100, 95)]);

    expect(window).toMatchObject({ open: false, anchorClose: null, recoveredOn: '2026-11-06' });
    expect(window.lastPanic?.date).toBe('2026-11-05');
  });

  it('连续恐慌还按第一次的跌前收盘算', () => {
    const window = panicWindow([day('2026-11-05', 95, 100, true), day('2026-11-06', 90, 95, true), day('2026-11-09', 96, 90)]);

    expect(window).toMatchObject({ open: true, anchorClose: 100 });
    expect(window.lastPanic?.date).toBe('2026-11-06');
  });

  it('收复后再恐慌，按新的跌前收盘重新打开', () => {
    const window = panicWindow([day('2026-11-05', 95, 100, true), day('2026-11-06', 101, 95), day('2026-11-09', 97, 101, true)]);

    expect(window).toMatchObject({ open: true, anchorClose: 101, recoveredOn: null });
  });
});

describe('返回给网页的数据', () => {
  const closes = {
    sp500: series([['2026-11-03', 100], ['2026-11-04', 101], ['2026-11-05', 96]]),
    dow: series([['2026-11-03', 100], ['2026-11-04', 103], ['2026-11-05', 99]]),
    nasdaq: series([['2026-11-03', 100], ['2026-11-04', 101], ['2026-11-05', 95]]),
  };

  it('最新的排前面，带窗口状态', () => {
    const payload = buildPanicPayload({ closes, now: new Date('2026-11-05T22:00:00.000Z') });

    expect(payload).toMatchObject({ as_of: '2026-11-05', threshold_pct: -3, window_open: true, anchor_close: 101, recovered_on: null });
    expect(payload.last_panic.date).toBe('2026-11-05');
    expect(payload.days.map((row: { date: string }) => row.date)).toEqual(['2026-11-05', '2026-11-04']);
    expect(payload.days[0]).toMatchObject({ panic: true });
  });

  it('只给最近 30 天', () => {
    const many = Array.from({ length: 40 }, (_, index): [string, number] => [`2026-09-${String(index + 1).padStart(2, '0')}`, 100 + index]);
    const payload = buildPanicPayload({
      closes: { sp500: series(many), dow: series(many), nasdaq: series(many) }, now: new Date(),
    });

    expect(payload.days).toHaveLength(30);
  });

  it('没有数据时窗口是 null，不说「没有恐慌」', () => {
    const payload = buildPanicPayload({ closes: {}, now: new Date() });

    expect(payload).toMatchObject({ as_of: null, window_open: null, last_panic: null, days: [] });
  });
});

describe('服务器统一取数并缓存', () => {
  const rows = series([['2026-11-04', 100], ['2026-11-05', 99]]);

  it('30 分钟内只取一次，同时来的请求共用', async () => {
    let clock = Date.parse('2026-11-05T22:00:00.000Z');
    const fetchCloses = vi.fn(async () => rows);
    const cache = createPanicCache({ fetchCloses, now: () => new Date(clock) });

    await Promise.all([cache.read(), cache.read()]);
    await cache.read();
    expect(fetchCloses).toHaveBeenCalledTimes(3);

    clock += 30 * 60_000;
    await cache.read();
    expect(fetchCloses).toHaveBeenCalledTimes(6);
  });

  it('有一个指数失败就沿用它上一次的数，下次请求马上重取', async () => {
    let clock = Date.parse('2026-11-05T22:00:00.000Z');
    let failing = false;
    const fetchCloses = vi.fn(async (symbol: string) => {
      if (failing && symbol === '^DJI') throw new Error('timeout');
      return rows;
    });
    const cache = createPanicCache({ fetchCloses, now: () => new Date(clock) });
    await cache.read();

    failing = true;
    clock += 30 * 60_000;
    expect((await cache.read()).days).toHaveLength(1);

    await cache.read();
    expect(fetchCloses.mock.calls.filter(([symbol]) => symbol === '^DJI')).toHaveLength(3);
  });

  it('上游返回空数组也不记缓存', async () => {
    let empty = true;
    const fetchCloses = vi.fn(async () => (empty ? [] : rows));
    const cache = createPanicCache({ fetchCloses, now: () => new Date('2026-11-05T22:00:00.000Z') });

    expect((await cache.read()).window_open).toBeNull();
    empty = false;
    expect((await cache.read()).window_open).toBe(false);
  });
});

describe('只读路由', () => {
  const setup = () => {
    const sendJson = vi.fn();
    return { sendJson, route: createPanicRoute({ cache: { read: async () => ({ days: [] }) }, sendJson }) };
  };

  it('GET 返回数据', async () => {
    const { route, sendJson } = setup();
    const res = {};

    await expect(route(new URL('http://x/api/portfolio/panic-drop'), { method: 'GET' }, res)).resolves.toBe(true);
    expect(sendJson).toHaveBeenCalledWith(res, 200, { panic: { days: [] } });
  });

  it('其他方法 405，其他路径不处理', async () => {
    const { route, sendJson } = setup();

    await route(new URL('http://x/api/portfolio/panic-drop'), { method: 'POST' }, {});
    expect(sendJson.mock.calls[0][1]).toBe(405);
    await expect(route(new URL('http://x/api/other'), { method: 'GET' }, {})).resolves.toBe(false);
  });
});
