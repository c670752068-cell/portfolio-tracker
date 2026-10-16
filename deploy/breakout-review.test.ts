import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runChannelReviewCycle, readChannelReview, channelReviewTargetDate } from './channel-review.mjs';
import { knownTradingDate } from './market-session.mjs';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function harness() {
  const alertsRoot = await mkdtemp(join(tmpdir(), 'breakout-review-')); roots.push(alertsRoot);
  const notify = vi.fn(async () => ({ status: 'suppressed' }));
  const snapshot = { growth_watchlist: { active_symbols: ['AMZN', 'MSFT'] } };
  const fetchDashboard = async (symbol: string, now: Date) => {
    const end = now.toISOString().slice(0, 10);
    const series = [];
    for (let d = new Date('2026-08-03T12:00:00Z'); d.toISOString().slice(0, 10) <= end; d = new Date(+d + 86400000)) {
      const date = d.toISOString().slice(0, 10);
      if (knownTradingDate(date)) series.push({ date, is_partial: false, zscore200: ['AMZN', 'MSFT'].includes(symbol) && date >= '2026-09-16' ? -0.04 : 0.08 });
    }
    return { dashboard: { series, channel_alert: { as_of: end, complete_close: true, available: true, z_score: series.at(-1)?.zscore200 } } };
  };
  const run = (time: string) => runChannelReviewCycle({ now: new Date(time), alertsRoot, snapshot, fetchDashboard, notify });
  return { alertsRoot, notify, run, snapshot, fetchDashboard };
}
describe('breakout review delivery lifecycle', () => {
  it('retries a same-date migration failure instead of treating the old review date as success', async () => {
    const h = await harness();
    await writeFile(join(h.alertsRoot, 'channel-review.json'), JSON.stringify({ review_date: '2026-09-16', symbols: {} }));
    await runChannelReviewCycle({ now: new Date('2026-09-16T20:20:00Z'), alertsRoot: h.alertsRoot, snapshot: h.snapshot,
      fetchDashboard: async (symbol: string, now: Date) => { if (symbol === 'AMZN') throw new Error('temporary'); return h.fetchDashboard(symbol, now); }, notify: h.notify });
    expect((await readChannelReview(h.alertsRoot)).failed_symbols).toEqual(['AMZN']);
    const result = await h.run('2026-09-16T20:51:00Z');
    expect(result.skipped).toBe(false); expect(result.failed_symbols).toEqual([]); expect(h.notify).not.toHaveBeenCalled();
  });
  it('batches newly confirmed events once, stores history, and never replays after restart', async () => {
    const h = await harness();
    await h.run('2026-09-15T20:20:00Z'); expect(h.notify).not.toHaveBeenCalled();
    await h.run('2026-09-16T20:20:00Z'); expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify.mock.calls[0][0].title).toContain('2 个标的');
    const stored = await readChannelReview(h.alertsRoot);
    expect(stored.breakouts.AMZN).toMatchObject({ status: 'triggered', as_of: '2026-09-16', event: { direction: 'down' } });
    expect(stored.breakout_history).toHaveLength(2);
    await h.run('2026-09-16T20:51:00Z'); expect(h.notify).toHaveBeenCalledTimes(1);
    await h.run('2026-09-17T20:20:00Z'); expect(h.notify).toHaveBeenCalledTimes(1);
    expect((await readChannelReview(h.alertsRoot)).breakouts.AMZN.event).toBeNull();
  });
  it('upgrade reads historical signals without pushing and never backfills a late restart', async () => {
    const h = await harness();
    await writeFile(join(h.alertsRoot, 'channel-review.json'), JSON.stringify({ review_date: '2026-09-16', symbols: {} }));
    await h.run('2026-09-16T20:30:00Z'); expect(h.notify).not.toHaveBeenCalled();
    expect((await readChannelReview(h.alertsRoot)).breakout_history).toHaveLength(2);
    const second = await harness();
    await second.run('2026-09-15T20:20:00Z');
    await second.run('2026-09-16T23:00:00Z'); expect(second.notify).not.toHaveBeenCalled();
  });
  it('missing stock/reference sessions fail closed and review skips market holidays', async () => {
    const h = await harness();
    expect(channelReviewTargetDate(new Date('2026-09-07T21:00:00Z'))).toBe('2026-09-04');
    await h.run('2026-09-15T20:20:00Z');
    await runChannelReviewCycle({ now: new Date('2026-09-16T20:20:00Z'), alertsRoot: h.alertsRoot, snapshot: h.snapshot, notify: h.notify,
      fetchDashboard: async (symbol: string, now: Date) => { const value = await h.fetchDashboard(symbol, now); value.dashboard.series = value.dashboard.series.filter(p => p.date !== '2026-09-10'); return value; } });
    expect(h.notify).not.toHaveBeenCalled();
    const stored = JSON.parse(await readFile(join(h.alertsRoot, 'channel-review.json'), 'utf8'));
    expect(stored.breakouts.AMZN.event).toBeNull();
  });
  it('retries only failed instruments and references even when an upgrade had the same review date', async () => {
    const h = await harness();
    await h.run('2026-09-15T20:20:00Z');
    const fetchDashboard = vi.fn(async (symbol: string, now: Date) => {
      if (symbol === 'AMZN') throw new Error('temporary upstream failure');
      return h.fetchDashboard(symbol, now);
    });
    await runChannelReviewCycle({ now: new Date('2026-09-16T20:20:00Z'), alertsRoot: h.alertsRoot, snapshot: h.snapshot, fetchDashboard, notify: h.notify });
    expect(h.notify).toHaveBeenCalledTimes(1);
    const retryFetch = vi.fn(h.fetchDashboard);
    await runChannelReviewCycle({ now: new Date('2026-09-16T20:51:00Z'), alertsRoot: h.alertsRoot, snapshot: h.snapshot, fetchDashboard: retryFetch, notify: h.notify });
    expect(retryFetch.mock.calls.map(args => args[0]).sort()).toEqual(['AMZN', 'NDX', 'SPX']);
    expect((await readChannelReview(h.alertsRoot)).failed_symbols).toEqual([]);
    expect(h.notify).toHaveBeenCalledTimes(2);
    expect(h.notify.mock.calls[1][0].body).toContain('AMZN');
    expect(h.notify.mock.calls[1][0].body).not.toContain('MSFT');
    await h.run('2026-09-16T21:22:00Z'); expect(h.notify).toHaveBeenCalledTimes(2);
  });
});
