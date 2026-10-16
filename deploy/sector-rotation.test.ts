import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSectorRotationRoute, parseRotationHistory, rotationCalendar, SECTOR_SYMBOLS } from './sector-rotation.mjs';

function history(symbol = 'SPY', prices: (number | null)[] = [100, 101, 102]) {
  return { chart: { result: [{ meta: { symbol, currency: 'USD' }, timestamp: prices.map((_, i) => Date.parse(`2026-10-0${i + 5}T13:30:00Z`) / 1000), indicators: { adjclose: [{ adjclose: prices }], quote: [{ close: prices.map(() => 999) }] } }] } };
}
const date = new Date('2026-10-07T21:00:00Z');
const tempDirs: string[] = [];
afterEach(async () => { for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe('sector rotation market data boundary', () => {
  it('excludes an unfinished close and waits 20 minutes after the bell', () => {
    expect(rotationCalendar(new Date('2026-10-06T20:19:59Z')).expected_close).toBe('2026-10-05');
    expect(rotationCalendar(new Date('2026-10-06T20:20:00Z')).expected_close).toBe('2026-10-06');
    expect(rotationCalendar(new Date('2026-10-06T14:00:00Z')).completed_week).toBe('2026-10-02');
    expect(rotationCalendar(new Date('2026-10-09T20:20:00Z')).completed_week).toBe('2026-10-09');
  });
  it('handles holidays, weekends and early closes, and flags uncovered calendar years', () => {
    expect(rotationCalendar(new Date('2026-04-03T21:00:00Z'))).toMatchObject({ expected_close: '2026-04-02', completed_week: '2026-04-03' });
    expect(rotationCalendar(new Date('2026-09-07T21:00:00Z')).expected_close).toBe('2026-09-04');
    expect(rotationCalendar(new Date('2026-10-11T16:00:00Z')).completed_week).toBe('2026-10-09');
    expect(rotationCalendar(new Date('2026-11-27T18:19:00Z')).expected_close).toBe('2026-11-25');
    expect(rotationCalendar(new Date('2026-11-27T18:20:00Z')).expected_close).toBe('2026-11-27');
    expect(rotationCalendar(new Date('2027-03-02T22:00:00Z')).calendar_verified).toBe(false);
  });
  it('uses only split/dividend-adjusted USD data, never raw prices or partial bars', () => {
    const parsed = parseRotationHistory('SPY', history(), new Date('2026-10-07T15:00:00Z'));
    expect(parsed.series).toEqual([{ date: '2026-10-05', close: 100 }, { date: '2026-10-06', close: 101 }]);
    expect(parsed.as_of).toBe('2026-10-06');
    expect(parsed.adjustment).toBe('split_and_dividend_adjusted');
    const missing = history();
    missing.chart.result[0].indicators.adjclose = [];
    expect(() => parseRotationHistory('SPY', missing, date)).toThrow('缺少');
    const wrongCurrency = history(); wrongCurrency.chart.result[0].meta.currency = 'HKD';
    expect(() => parseRotationHistory('SPY', wrongCurrency, date)).toThrow('美元');
    expect(() => parseRotationHistory('NVDA', history('MSFT'), date)).toThrow('代码不匹配');
    expect(() => parseRotationHistory('SPY', history('SPY', [null, -1, 0]), date)).toThrow('不足');
    expect(parseRotationHistory('BRK.B', history('BRK-B'), date).symbol).toBe('BRK.B');
  });

  function harness(fetchJson = vi.fn(async (url: string) => history(decodeURIComponent(new URL(url).pathname.split('/').at(-1)!))), clock = () => date, cacheRoot?: string) {
    const sendJson = vi.fn();
    const route = createSectorRotationRoute({ fetchJson, sendJson, clock, cacheRoot });
    const call = async (suffix = '', method = 'GET') => {
      const res = {};
      await route(new URL(`https://example.test/api/portfolio/sector-rotation${suffix}`), { method, socket: { remoteAddress: 'test' } }, res);
      return sendJson.mock.calls.findLast(args => args[0] === res)!;
    };
    return { route, call, fetchJson, sendJson };
  }
  it('loads exactly eleven sectors plus the benchmark and caches/deduplicates reads', async () => {
    const h = harness();
    const [, status, body] = await h.call();
    expect(status).toBe(200);
    expect(Object.keys(body.series)).toEqual(['SPY', ...SECTOR_SYMBOLS]);
    expect(h.fetchJson).toHaveBeenCalledTimes(12);
    await Promise.all([h.call(), h.call()]);
    expect(h.fetchJson).toHaveBeenCalledTimes(12);
    for (const value of Object.values(body.series)) expect(value).toMatchObject({ available: true, stale: false });
  });
  it('bounds concurrent upstream requests to three and deduplicates in-flight tickers', async () => {
    let active = 0, peak = 0;
    const upstream = vi.fn(async (url: string) => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5)); active--;
      return history(new URL(url).pathname.split('/').at(-1)!);
    });
    const h = harness(upstream);
    await Promise.all([h.call(), h.call()]);
    expect(peak).toBe(3);
    expect(upstream).toHaveBeenCalledTimes(12);
  });
  it('rejects mutations, unsafe symbols, oversized batches and excessive requests', async () => {
    const h = harness();
    expect((await h.call('', 'POST'))[1]).toBe(405);
    expect((await h.call('?symbols=..%2Fsecret'))[1]).toBe(400);
    expect((await h.call('?symbols='))[1]).toBe(400);
    expect((await h.call('?symbols=' + Array.from({ length: 13 }, (_, i) => `A${i}`).join(',')))[1]).toBe(400);
    for (let i = 0; i < 30; i++) expect((await h.call('?symbols=SPY'))[1]).toBe(200);
    expect((await h.call('?symbols=SPY'))[1]).toBe(429);
    expect(h.fetchJson).toHaveBeenCalledTimes(1);
    expect(await h.route(new URL('https://example.test/api/other'), { method: 'GET' }, {})).toBe(false);
  });
  it('persists last good data and marks it stale on upstream failure; retries are bounded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sector-rotation-test-')); tempDirs.push(dir);
    let now = date;
    const upstream = vi.fn(async () => history());
    const first = harness(upstream, () => now, dir);
    await first.call('?symbols=SPY');
    const fail = vi.fn(async () => { throw new Error('private upstream details'); });
    const second = harness(fail, () => now, dir);
    expect((await second.call('?symbols=SPY'))[2].series.SPY.stale).toBe(false);
    expect(fail).not.toHaveBeenCalled();
    now = new Date(+date + 16 * 60_000);
    const body = (await second.call('?symbols=SPY'))[2];
    expect(body.series.SPY).toMatchObject({ available: true, stale: true, error: '刷新失败，展示上次成功数据' });
    expect(JSON.stringify(body)).not.toContain('private upstream details');
    await second.call('?symbols=SPY');
    expect(fail).toHaveBeenCalledTimes(1);
  });
  it('shows honest missing and stale states instead of fabricated fallback values', async () => {
    const h = harness(vi.fn(async () => { throw new Error('unavailable'); }));
    expect((await h.call('?symbols=SPY'))[2].series.SPY).toMatchObject({ available: false, stale: true });
    const old = harness(undefined, () => new Date('2026-10-08T21:00:00Z'));
    expect((await old.call('?symbols=SPY'))[2].series.SPY).toMatchObject({ available: true, stale: true, as_of: '2026-10-07' });
  });
});
