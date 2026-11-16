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
    // 18:00 那次最终价复核错过了（比如服务器没在跑）：第二天第一次运行时补做一次，只做一次
    await expect(runChannelReviewCycle({
      now: new Date('2026-08-20T20:19:00Z'), snapshot, alertsRoot, fetchDashboard,
    })).resolves.toMatchObject({ skipped: false, final: true, review_date: '2026-08-19', confirmed_date: '2026-08-19' });
    const calls = fetchDashboard.mock.calls.length;
    await expect(runChannelReviewCycle({
      now: new Date('2026-08-20T20:19:30Z'), snapshot, alertsRoot, fetchDashboard,
    })).resolves.toMatchObject({ skipped: true, review_date: '2026-08-19' });
    expect(fetchDashboard).toHaveBeenCalledTimes(calls);
  });
});

describe('刷新失败不清空上一份完整收盘', () => {
  it('零点刚过仍以上一个交易日为审查目标，不去找没开盘的当天', () => {
    // 2026-10-16T04:17Z = 美东 10-16 00:17
    expect(channelReviewTargetDate(new Date('2026-10-16T04:17:00Z'))).toBe('2026-10-15');
    // 美东 10-15 23:31，收盘审查已完成
    expect(channelReviewTargetDate(new Date('2026-10-16T03:31:00Z'))).toBe('2026-10-15');
    // 美东 10-16 16:20 之后才轮到当天
    expect(channelReviewTargetDate(new Date('2026-10-16T20:20:00Z'))).toBe('2026-10-16');
  });

  it('日线读取失败时保留上一份 Z 与审查日期，并在 failed_symbols 里报出来', async () => {
    const alertsRoot = await root();
    const snapshot = { symbols: { NVDA: { ma_slope: { available: true } } } };
    const dashboard = (symbol: string) => ({
      dashboard: {
        channel_alert: { ...alert('sell_near', '接近卖'), as_of: '2026-10-15' },
        series: [{ date: '2026-10-15', zscore200: 0.82, is_partial: false }],
      },
      symbol,
    });

    const first = await runChannelReviewCycle({
      now: new Date('2026-10-15T20:30:00Z'), snapshot, alertsRoot, force: true,
      fetchDashboard: async (symbol: string) => dashboard(symbol),
    });
    expect(first.review_date).toBe('2026-10-15');
    expect(first.failed_symbols).toEqual([]);

    const second = await runChannelReviewCycle({
      now: new Date('2026-10-16T04:17:00Z'), snapshot, alertsRoot, force: true,
      fetchDashboard: async () => { throw new Error('upstream 429'); },
    });

    expect(second.failed_symbols).toContain('NVDA');
    expect(second.review_date).toBe('2026-10-15');
    const stored = JSON.parse(await readFile(join(alertsRoot, 'channel-review.json'), 'utf8'));
    expect(stored.symbols.NVDA.z_score).toBe(1.6);
    expect(stored.symbols.NVDA.as_of).toBe('2026-10-15');
    expect(stored.review_date).toBe('2026-10-15');
  });
});

// 美东 2026-10-01 ~ 10-30 的交易日（22 天，没有休市日），最后一天是 10-30
const SESSIONS: string[] = [];
for (let day = 1; day <= 30; day += 1) {
  const date = new Date(Date.UTC(2026, 9, day, 12));
  if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) SESSIONS.push(date.toISOString().slice(0, 10));
}

/** 前面 21 天都在 0 上方，最后一天（10-30）的 Z 由参数决定；until 截到哪一天。 */
function zDashboard(lastZ: number, until = '2026-10-30') {
  const series = SESSIONS.filter(date => date <= until)
    .map((date, index, all) => ({ date, zscore200: index === all.length - 1 && date === '2026-10-30' ? lastZ : 0.4, is_partial: false }));
  return { dashboard: { channel_alert: { ...alert('neutral', '通道内'), as_of: series.at(-1)!.date, z_score: series.at(-1)!.zscore200 }, series } };
}

describe('18:00 用最终收盘价复核', () => {
  const snapshot = { growth_watchlist: { active_symbols: ['NVDA'] } };

  async function baseline(alertsRoot: string) {
    // 10-29 先完整跑一遍（含最终价复核），建立基线
    await runChannelReviewCycle({
      now: new Date('2026-10-29T22:00:30Z'), snapshot, alertsRoot,
      fetchDashboard: async () => zDashboard(0.4, '2026-10-29'),
    });
  }

  it('16:20 按非最终价记了露头，18:00 最终价不成立：删掉这个露头、覆盖当天的 Z，不再推送', async () => {
    const alertsRoot = await root();
    await baseline(alertsRoot);
    const notify = vi.fn(async () => {});

    const provisional = await runChannelReviewCycle({
      now: new Date('2026-10-30T20:20:30Z'), snapshot, alertsRoot, notify,
      fetchDashboard: async (symbol: string) => zDashboard(symbol === 'NVDA' ? -0.065 : 0.4),
    });
    expect(provisional).toMatchObject({ skipped: false, final: false });
    expect(provisional.symbols.NVDA).toMatchObject({ z_score: -0.065, final_close: false });
    expect(notify).toHaveBeenCalledTimes(1);
    let stored = JSON.parse(await readFile(join(alertsRoot, 'channel-review.json'), 'utf8'));
    expect(stored.breakout_history.map((e: { id: string }) => e.id)).toContain('NVDA:2026-10-30:down');
    expect(stored.confirmed_date).toBe('2026-10-29');

    // 17:00 还没到复核时间
    await expect(runChannelReviewCycle({
      now: new Date('2026-10-30T21:00:00Z'), snapshot, alertsRoot, notify,
      fetchDashboard: async () => zDashboard(0.015),
    })).resolves.toMatchObject({ skipped: true });

    const final = await runChannelReviewCycle({
      now: new Date('2026-10-30T22:00:30Z'), snapshot, alertsRoot, notify,
      fetchDashboard: async () => zDashboard(0.015),
    });
    expect(final).toMatchObject({ skipped: false, final: true, confirmed_date: '2026-10-30' });
    expect(final.symbols.NVDA).toMatchObject({ z_score: 0.015, final_close: true });
    expect(final.dropped_events.map((e: { id: string }) => e.id)).toEqual(['NVDA:2026-10-30:down']);
    expect(notify).toHaveBeenCalledTimes(1);
    stored = JSON.parse(await readFile(join(alertsRoot, 'channel-review.json'), 'utf8'));
    expect(stored.breakout_history.map((e: { id: string }) => e.id)).not.toContain('NVDA:2026-10-30:down');
    expect(stored.symbols.NVDA.z_score).toBe(0.015);

    // 复核完就不再跑
    await expect(runChannelReviewCycle({
      now: new Date('2026-10-30T22:40:00Z'), snapshot, alertsRoot, notify,
      fetchDashboard: async () => zDashboard(0.015),
    })).resolves.toMatchObject({ skipped: true });
  });

  it('16:20 没看到、最终价才出现的露头：18:00 补推一次；16:20 已推过的不重复推', async () => {
    const alertsRoot = await root();
    await baseline(alertsRoot);
    const notify = vi.fn(async () => {});
    await runChannelReviewCycle({
      now: new Date('2026-10-30T20:20:30Z'), snapshot, alertsRoot, notify,
      fetchDashboard: async () => zDashboard(0.015),
    });
    expect(notify).not.toHaveBeenCalled();

    await runChannelReviewCycle({
      now: new Date('2026-10-30T22:00:30Z'), snapshot, alertsRoot, notify,
      fetchDashboard: async (symbol: string) => zDashboard(symbol === 'NVDA' ? -0.14 : 0.4),
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ category: 'breakout', direction: 'down' });

    const pushedTwice = vi.fn(async () => {});
    const again = await root();
    await baseline(again);
    await runChannelReviewCycle({
      now: new Date('2026-10-30T20:20:30Z'), snapshot, alertsRoot: again, notify: pushedTwice,
      fetchDashboard: async (symbol: string) => zDashboard(symbol === 'NVDA' ? -0.14 : 0.4),
    });
    await runChannelReviewCycle({
      now: new Date('2026-10-30T22:00:30Z'), snapshot, alertsRoot: again, notify: pushedTwice,
      fetchDashboard: async (symbol: string) => zDashboard(symbol === 'NVDA' ? -0.14 : 0.4),
    });
    expect(pushedTwice).toHaveBeenCalledTimes(1);
  });

  it('升级后第一次复核把旧版本留下的假露头全部清掉，真实的保留', async () => {
    const alertsRoot = await root();
    await baseline(alertsRoot);
    const path = join(alertsRoot, 'channel-review.json');
    const stored = JSON.parse(await readFile(path, 'utf8'));
    const fake = { id: 'NVDA:2026-10-15:down', symbol: 'NVDA', date: '2026-10-15', direction: 'down', sessions: 5, previous_z: 0.1, z: -0.05, confirmed: true };
    // 日线最前面的露头：它之前的 30 天连续同号已经滑出这次的日线窗口，认不出来，但不能当假的删
    const edge = { id: 'NVDA:2026-10-05:up', symbol: 'NVDA', date: '2026-10-05', direction: 'up', sessions: 30, previous_z: -0.1, z: 0.05, confirmed: true };
    const old = { id: 'NVDA:2022-01-27:down', symbol: 'NVDA', date: '2022-01-27', direction: 'down', sessions: 50, previous_z: 0.1, z: -0.05, confirmed: true };
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, JSON.stringify({ ...stored, history_pruned: undefined, breakout_history: [old, edge, fake] }));

    const result = await runChannelReviewCycle({
      now: new Date('2026-10-30T22:00:30Z'), snapshot, alertsRoot,
      fetchDashboard: async () => zDashboard(0.4),
    });
    expect(result.dropped_events.map((e: { id: string }) => e.id)).toEqual(['NVDA:2026-10-15:down']);
    const after = JSON.parse(await readFile(path, 'utf8'));
    expect(after.history_pruned).toBe(true);
    // 2022 年那条不在这次日线范围内、10-05 那条前面的连续天数不完整，都不动
    expect(after.breakout_history.map((e: { id: string }) => e.id)).toEqual(['NVDA:2022-01-27:down', 'NVDA:2026-10-05:up']);
  });
});
