import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  channelReviewSymbols,
  channelReviewTargetDate,
  runChannelReviewCycle,
} from './channel-review.mjs';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'channel-review-'));
  roots.push(value);
  return value;
}

function alert(state: string, label: string) {
  return {
    available: true, state, signal: state.startsWith('buy') ? 'buy' : 'sell', label,
    as_of: '2026-08-20', close: 100, lower_band: 105, upper_band: 135,
    z_score: state.startsWith('buy') ? -1.6 : 1.6,
    complete_close: true, decision_use: false, buy_veto: false, reason: 'test',
  };
}

describe('daily channel review', () => {
  it('includes held stocks/ETFs outside the watchlist, not options, zero positions or cash', () => {
    const list = channelReviewSymbols({}, [{ symbol: 'NAIL', asset_type: 'etf', qty: 10 }, { symbol: 'US.TSLL', asset_type: 'etf', qty: 1 }, { symbol: 'AMD', asset_type: 'option', qty: 2 }, { symbol: 'SGOV', asset_type: 'etf', qty: 100 }, { symbol: 'NVDA', asset_type: 'stock', qty: 0 }]);
    expect(list).toEqual(['NAIL', 'TSLL', 'NDX', 'SOX', 'SPX']);
  });
  it('reviews the visible ticker universe once after 16:20 ET and stores all colors', async () => {
    const alertsRoot = await root();
    const snapshot = {
      growth_watchlist: { active_symbols: ['NVDA', 'WMT', 'SGOV'] },
      symbols: { META: { ma_slope: { available: true } } },
    };
    expect(channelReviewSymbols(snapshot)).toEqual(['NVDA', 'WMT', 'META', 'NDX', 'SOX', 'SPX']);
    const fetchDashboard = vi.fn(async (symbol: string) => ({
      dashboard: { channel_alert: symbol === 'WMT' ? alert('buy', '可以买') : alert('sell', '可以卖') },
    }));

    const first = await runChannelReviewCycle({
      now: new Date('2026-08-20T20:20:30Z'), snapshot, alertsRoot, fetchDashboard,
    });
    expect(first).toMatchObject({ skipped: false, review_date: '2026-08-20', failed_symbols: [] });
    expect(first.symbols.WMT).toMatchObject({ state: 'buy', label: '可以买', stale: false });
    expect(first.symbols.NVDA).toMatchObject({ state: 'sell', label: '可以卖' });
    expect(fetchDashboard).toHaveBeenCalledTimes(6);

    const second = await runChannelReviewCycle({
      now: new Date('2026-08-20T21:00:00Z'), snapshot, alertsRoot, fetchDashboard,
    });
    expect(second.skipped).toBe(true);
    expect(fetchDashboard).toHaveBeenCalledTimes(6);
    expect(JSON.parse(await readFile(join(alertsRoot, 'channel-review.json'), 'utf8')))
      .toMatchObject({ review_time: '16:20', timezone: 'America/New_York' });
  });

  it('uses the previous trading day before 16:20 ET so a restart never misses a close', async () => {
    const alertsRoot = await root();
    const snapshot = { growth_watchlist: { active_symbols: ['META'] } };
    const fetchDashboard = vi.fn(async () => ({ dashboard: { channel_alert: alert('buy', '可以买') } }));
    expect(channelReviewTargetDate(new Date('2026-08-21T04:30:00Z'))).toBe('2026-08-20');
    await expect(runChannelReviewCycle({
      now: new Date('2026-08-21T04:30:00Z'), snapshot, alertsRoot, fetchDashboard,
    })).resolves.toMatchObject({ skipped: false, review_date: '2026-08-20' });
    expect(fetchDashboard).toHaveBeenCalled();
  });

  it('does not repeat the previous-close review before the next fixed review time', async () => {
    const alertsRoot = await root();
    const snapshot = { growth_watchlist: { active_symbols: ['META'] } };
    const fetchDashboard = vi.fn(async () => ({ dashboard: { channel_alert: alert('buy', '可以买') } }));
    await runChannelReviewCycle({
      now: new Date('2026-08-19T20:20:30Z'), snapshot, alertsRoot, fetchDashboard,
    });
    const calls = fetchDashboard.mock.calls.length;
    await expect(runChannelReviewCycle({
      now: new Date('2026-08-20T20:19:00Z'), snapshot, alertsRoot, fetchDashboard,
    })).resolves.toMatchObject({ skipped: true, review_date: '2026-08-19' });
    expect(fetchDashboard).toHaveBeenCalledTimes(calls);
  });
});
