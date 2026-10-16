import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeExtreme, extremePushBatches } from './z-extreme.mjs';
import { runChannelReviewCycle } from './channel-review.mjs';
const rule = { positiveThreshold: 1.4, negativeThreshold: 1.4 };
const dates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'];
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const point = (date: string, zscore200: number | null, is_partial = false) => ({ date, zscore200, is_partial });
describe('custom Z-Score threshold notifications', () => {
  it('includes equality at +1.4 and −1.4 but does not repeat while staying outside', () => {
    for (const sign of [1, -1]) {
      const series = [point(dates[0], sign * 1.39), point(dates[1], sign * 1.4), point(dates[2], sign * 1.6)];
      const event = analyzeExtreme('AMZN', series, dates, dates[1], rule).event;
      expect(event).toMatchObject({ threshold: 1.4, direction: sign > 0 ? 'positive' : 'negative', confirmed: true });
      expect(analyzeExtreme('AMZN', series, dates, dates[2], rule).event).toBeNull();
    }
  });
  it('uses independent thresholds and only confirms real closed adjacent trading sessions', () => {
    const series = [point(dates[0], 1.39), point(dates[1], 1.45), point(dates[2], 1.65, true)];
    expect(analyzeExtreme('X', series, dates, dates[1], { ...rule, positiveThreshold: 1.5 }).event).toBeNull();
    expect(analyzeExtreme('X', series, dates, dates[2], rule).status).toBe('unavailable');
    expect(analyzeExtreme('X', [point(dates[0], 1.3), point(dates[2], 1.6)], dates, dates[2], rule).status).toBe('unavailable');
    expect(analyzeExtreme('X', [point(dates[0], NaN), point(dates[1], 1.6)], dates, dates[1], rule).event).toBeNull();
    expect(analyzeExtreme('X', [point(dates[0], 0), point(dates[1], -1.6)], dates, dates[1], { ...rule, negativeThreshold: 1.5 }).event.threshold).toBe(1.5);
  });
  it('rearms after returning inside and makes deterministic batches with no trade claims', () => {
    const series = dates.map((d, i) => point(d, [1.2, 1.4, 1.6, 1.3, 1.5][i]));
    const first = analyzeExtreme('AAPL', series, dates, dates[1], rule).event;
    const last = analyzeExtreme('AAPL', series, dates, dates[4], rule).event;
    expect(last.id).not.toBe(first.id);
    const batches = extremePushBatches([first], new Date('2026-09-15T20:20:00Z'), '2026-09-15T20:20:00Z');
    expect(batches[0]).toMatchObject({ category: 'zExtreme', direction: 'positive', threshold: 1.4, confirmed: true });
    expect(batches[0].body).toContain('不代表已到 ±1.5');
  });
  it('baselines on upgrade, sends a new crossing once, handles retry, and never backfills late', async () => {
    const alertsRoot = await mkdtemp(join(tmpdir(), 'extreme-review-')); roots.push(alertsRoot);
    const notify = vi.fn(async () => ({ status: 'suppressed' }));
    const snapshot = { growth_watchlist: { active_symbols: ['AAPL', 'MSFT'] } };
    const fetchDashboard = async (_symbol: string, now: Date) => {
      const date = now.toISOString().slice(0, 10);
      const series = dates.filter(d => d <= date).map(d => point(d, d >= dates[2] ? 1.45 : 1.3));
      return { dashboard: { series, channel_alert: { available: true, complete_close: true, as_of: date } } };
    };
    const run = (time: string) => runChannelReviewCycle({ alertsRoot, snapshot, notify, fetchDashboard, now: new Date(time), extremeRule: rule });
    await run('2026-09-15T20:20:00Z'); expect(notify).not.toHaveBeenCalled();
    await runChannelReviewCycle({ alertsRoot, snapshot, notify, now: new Date('2026-09-16T20:20:00Z'), extremeRule: rule,
      fetchDashboard: async (symbol: string, now: Date) => { if (symbol === 'AAPL') throw new Error('temporary'); return fetchDashboard(symbol, now); } });
    expect(notify).toHaveBeenCalledTimes(1); expect(notify.mock.calls[0][0].body).not.toContain('AAPL');
    await run('2026-09-16T20:51:00Z'); expect(notify).toHaveBeenCalledTimes(2); expect(notify.mock.calls[1][0].body).toContain('AAPL');
    await run('2026-09-16T20:52:00Z'); await run('2026-09-17T20:20:00Z'); expect(notify).toHaveBeenCalledTimes(2);
    const state = JSON.parse(await readFile(join(alertsRoot, 'channel-review.json'), 'utf8')); expect(state.extreme_version).toBe(1);
    const lateRoot = await mkdtemp(join(tmpdir(), 'extreme-late-')); roots.push(lateRoot);
    await runChannelReviewCycle({ alertsRoot: lateRoot, snapshot, notify, fetchDashboard, now: new Date('2026-09-15T20:20:00Z') });
    await runChannelReviewCycle({ alertsRoot: lateRoot, snapshot, notify, fetchDashboard, now: new Date('2026-09-16T23:00:00Z') });
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
