import { describe, expect, it, vi } from 'vitest';
import { createOvernightQuoteStore, normalizeOvernightUpload } from './overnight-quotes.mjs';

const NOW = new Date('2026-10-22T07:02:00.000Z');

describe('接收富途推上来的夜盘报价', () => {
  it('只收形状对的条目，价格或时间不合法的丢掉', () => {
    const parsed = normalizeOvernightUpload({
      source: 'futu_opend',
      quotes: [
        { symbol: 'US.QQQ', price: 725.2, previousClose: 717.63, priceTime: '2026-10-22T07:01:41.000Z' },
        { symbol: 'TQQQ', price: 72.61, previousClose: 70.41, priceTime: '2026-10-22T07:01:42.000Z' },
        { symbol: 'BAD', price: 0, priceTime: '2026-10-22T07:01:42.000Z' },
        { symbol: '', price: 10, priceTime: '2026-10-22T07:01:42.000Z' },
        { symbol: 'NOTIME', price: 10, priceTime: '不是时间' },
      ],
    });

    expect(Object.keys(parsed)).toEqual(['QQQ', 'TQQQ']);
    expect(parsed.QQQ).toMatchObject({ price: 725.2, previousClose: 717.63, source: 'futu_opend' });
  });

  it('不是对象或没有 quotes 时返回空，不报错', () => {
    expect(normalizeOvernightUpload(null)).toEqual({});
    expect(normalizeOvernightUpload({ quotes: 'x' })).toEqual({});
  });
});

describe('夜盘报价仓库', () => {
  it('存进去能按标的取出来，过期的取不到', () => {
    const store = createOvernightQuoteStore();
    store.put(normalizeOvernightUpload({
      quotes: [{ symbol: 'QQQ', price: 725.2, previousClose: 717.63, priceTime: '2026-10-22T07:01:41.000Z' }],
    }));

    expect(store.get('QQQ', NOW)).toMatchObject({ price: 725.2 });
    // 20 分钟之后就不该再用了
    expect(store.get('QQQ', new Date('2026-10-22T07:25:00.000Z'))).toBeNull();
    expect(store.get('TQQQ', NOW)).toBeNull();
  });

  it('记得上次收到推送的时间，用来判断通道是否还活着', () => {
    const store = createOvernightQuoteStore();
    expect(store.updatedAt()).toBeNull();
    store.put(normalizeOvernightUpload({ quotes: [{ symbol: 'QQQ', price: 1, priceTime: NOW.toISOString() }] }), NOW);
    expect(store.updatedAt()).toBe(+NOW);
  });
});

describe('接收路由', () => {
  function fakeRes() {
    return { statusCode: 0, body: null as unknown };
  }
  const sendJson = vi.fn((res: { statusCode: number; body: unknown }, status: number, body: unknown) => {
    res.statusCode = status;
    res.body = body;
  });

  it('没带正确令牌一律 401', async () => {
    const { createOvernightQuotesRoute } = await import('./overnight-quotes.mjs');
    const store = createOvernightQuoteStore();
    const handle = createOvernightQuotesRoute({
      store, token: 'secret', sendJson, readBody: async () => ({ quotes: [] }),
    });
    const res = fakeRes();

    await handle(new URL('http://x/api/portfolio/overnight-quotes'), { method: 'POST', headers: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  it('令牌对就收下并返回收了几条', async () => {
    const { createOvernightQuotesRoute } = await import('./overnight-quotes.mjs');
    const store = createOvernightQuoteStore();
    const handle = createOvernightQuotesRoute({
      store,
      token: 'secret',
      sendJson,
      readBody: async () => ({ quotes: [{ symbol: 'QQQ', price: 725.2, priceTime: '2026-10-22T07:01:41.000Z' }] }),
    });
    const res = fakeRes();

    const handled = await handle(
      new URL('http://x/api/portfolio/overnight-quotes'),
      { method: 'POST', headers: { authorization: 'Bearer secret' } },
      res,
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(store.get('QQQ', NOW)).toMatchObject({ price: 725.2 });
  });

  it('不是这个路径就不管', async () => {
    const { createOvernightQuotesRoute } = await import('./overnight-quotes.mjs');
    const handle = createOvernightQuotesRoute({
      store: createOvernightQuoteStore(), token: 'secret', sendJson, readBody: async () => ({}),
    });

    expect(await handle(new URL('http://x/api/health'), { method: 'POST', headers: {} }, fakeRes())).toBe(false);
  });
});
