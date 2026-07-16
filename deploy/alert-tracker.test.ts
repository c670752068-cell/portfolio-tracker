import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALERT_TRACK_INTERVAL_MS,
  buildBarkPushUrl,
  formatAlertNotification,
  isNewYorkRegularSession,
  runAlertTrackerCycle,
  sendBarkNotification,
  startAlertTracker,
} from './alert-tracker.mjs';

const temporaryRoots: string[] = [];

async function temporaryAlertsRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'portfolio-alert-state-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('server alert market window', () => {
  it('uses the New York regular session in both EDT and EST and stops on weekends', () => {
    expect(isNewYorkRegularSession(new Date('2026-07-15T13:29:59.000Z'))).toBe(false);
    expect(isNewYorkRegularSession(new Date('2026-07-15T13:30:00.000Z'))).toBe(true);
    expect(isNewYorkRegularSession(new Date('2026-07-15T19:59:59.000Z'))).toBe(true);
    expect(isNewYorkRegularSession(new Date('2026-07-15T20:00:00.000Z'))).toBe(false);
    expect(isNewYorkRegularSession(new Date('2026-01-15T14:30:00.000Z'))).toBe(true);
    expect(isNewYorkRegularSession(new Date('2026-07-18T16:00:00.000Z'))).toBe(false);
  });

  it('runs at a fixed 35-minute cadence and contains every rejected async cycle', async () => {
    expect(ALERT_TRACK_INTERVAL_MS).toBe(35 * 60 * 1000);
    let callback: (() => Promise<void>) | undefined;
    let delay = 0;
    let cycleCount = 0;
    const errors: string[] = [];
    const stop = startAlertTracker({
      runCycle: async () => {
        cycleCount += 1;
        throw new Error('upstream unavailable');
      },
      setIntervalImpl: (next, interval) => {
        callback = next;
        delay = interval;
        return 17;
      },
      clearIntervalImpl: vi.fn(),
      logError: (message) => errors.push(message),
    });

    expect(delay).toBe(ALERT_TRACK_INTERVAL_MS);
    expect(callback).toBeTypeOf('function');
    await expect(callback?.()).resolves.toBeUndefined();
    await expect(callback?.()).resolves.toBeUndefined();
    expect(cycleCount).toBe(2);
    expect(errors).toHaveLength(2);
    expect(errors.every((message) => message.includes('alert tracker cycle failed'))).toBe(true);
    stop();
  });
});

describe('alert event evaluation and durable deduplication', () => {
  it('pushes approach and reached once per New York trading day and persists state across cycles', async () => {
    const alertsRoot = await temporaryAlertsRoot();
    const notifications: Array<{ type: string; symbol: string }> = [];
    const rule = {
      id: 'fngu-target',
      symbol: 'FNGU',
      type: 'target_price',
      direction: 'above',
      target_price: 40,
      approach_pct: 5,
      reduce_to_pct: 5,
      enabled: true,
    };

    const first = await runAlertTrackerCycle({
      now: new Date('2026-07-15T15:00:00.000Z'),
      alertsRoot,
      rules: [rule],
      fetchQuotes: async () => ({ FNGU: 39 }),
      notify: async (event) => { notifications.push(event); },
    });
    expect(first.events.map((event) => event.type)).toEqual(['approach']);

    const second = await runAlertTrackerCycle({
      now: new Date('2026-07-15T15:35:00.000Z'),
      alertsRoot,
      rules: [rule],
      fetchQuotes: async () => ({ FNGU: 40.25 }),
      notify: async (event) => { notifications.push(event); },
    });
    expect(second.events.map((event) => event.type)).toEqual(['reached']);

    const restartedProcessCycle = await runAlertTrackerCycle({
      now: new Date('2026-07-15T16:10:00.000Z'),
      alertsRoot,
      rules: [rule],
      fetchQuotes: async () => ({ FNGU: 41 }),
      notify: async (event) => { notifications.push(event); },
    });
    expect(restartedProcessCycle.events).toEqual([]);
    expect(notifications.map((event) => event.type)).toEqual(['approach', 'reached']);

    const nextTradingDay = await runAlertTrackerCycle({
      now: new Date('2026-07-16T15:00:00.000Z'),
      alertsRoot,
      rules: [rule],
      fetchQuotes: async () => ({ FNGU: 41 }),
      notify: async (event) => { notifications.push(event); },
    });
    expect(nextTradingDay.events.map((event) => event.type)).toEqual(['reached']);

    const storedState = JSON.parse(await readFile(join(alertsRoot, 'state.json'), 'utf8'));
    expect(storedState).toEqual(expect.objectContaining({ rules: expect.any(Object) }));
  });

  it('handles downward targets and derives a gain target from cost without double firing', async () => {
    const alertsRoot = await temporaryAlertsRoot();
    const notifications: Array<{ type: string; symbol: string }> = [];
    const rules = [
      {
        id: 'down-target', symbol: 'MSFT', type: 'target_price', direction: 'below',
        target_price: 90, approach_pct: 5, reduce_to_pct: 5, enabled: true,
      },
      {
        id: 'gain-target', symbol: 'NVDA', type: 'gain_pct', cost_basis: 100,
        gain_pct: 20, approach_pct: 5, enabled: true,
      },
    ];
    const result = await runAlertTrackerCycle({
      now: new Date('2026-07-15T15:00:00.000Z'),
      alertsRoot,
      rules,
      fetchQuotes: async () => ({ MSFT: 89, NVDA: 121 }),
      notify: async (event) => { notifications.push(event); },
    });
    expect(result.events).toEqual([
      expect.objectContaining({ ruleId: 'down-target', symbol: 'MSFT', type: 'reached', targetPrice: 90 }),
      expect.objectContaining({ ruleId: 'gain-target', symbol: 'NVDA', type: 'reached', targetPrice: 120 }),
    ]);
    expect(notifications).toHaveLength(2);
  });

  it('does no quote work outside the regular session and deduplicates active symbols', async () => {
    const alertsRoot = await temporaryAlertsRoot();
    const fetchQuotes = vi.fn(async () => ({ MSFT: 500 }));
    const rules = [
      { id: 'a', symbol: 'MSFT', type: 'target_price', direction: 'above', target_price: 500, approach_pct: 5, enabled: true },
      { id: 'b', symbol: 'MSFT', type: 'target_price', direction: 'above', target_price: 550, approach_pct: 5, enabled: true },
    ];
    const closed = await runAlertTrackerCycle({
      now: new Date('2026-07-18T16:00:00.000Z'),
      alertsRoot,
      rules,
      fetchQuotes,
      notify: vi.fn(),
    });
    expect(closed).toEqual(expect.objectContaining({ skipped: true, events: [] }));
    expect(fetchQuotes).not.toHaveBeenCalled();

    await runAlertTrackerCycle({
      now: new Date('2026-07-15T15:00:00.000Z'),
      alertsRoot,
      rules,
      fetchQuotes,
      notify: vi.fn(),
    });
    expect(fetchQuotes).toHaveBeenCalledWith(['MSFT']);
  });

  it('keeps every free-quote batch at 50 unique symbols or fewer', async () => {
    const alertsRoot = await temporaryAlertsRoot();
    const rules = Array.from({ length: 51 }, (_, index) => ({
      id: `batch-${index}`,
      symbol: `T${String(index).padStart(2, '0')}`,
      type: 'target_price',
      direction: 'above',
      target_price: 100,
      approach_pct: 5,
      enabled: true,
    }));
    const fetchQuotes = vi.fn(async (symbols: string[]) => Object.fromEntries(
      symbols.map((symbol) => [symbol, 1]),
    ));
    await runAlertTrackerCycle({
      now: new Date('2026-07-15T15:00:00.000Z'),
      alertsRoot,
      rules,
      fetchQuotes,
      notify: vi.fn(),
    });
    const batches = fetchQuotes.mock.calls.map(([symbols]) => symbols);
    expect(batches).toHaveLength(2);
    expect(batches.every((symbols) => symbols.length <= 50)).toBe(true);
    expect(new Set(batches.flat()).size).toBe(51);
  });
});

describe('Bark delivery', () => {
  it('URL-encodes the device key, title, and message and keeps the fixed manual-action warning', () => {
    const notification = formatAlertNotification({
      id: 'fngu-target',
      symbol: 'FNGU',
      type: 'target_price',
      direction: 'above',
      target_price: 40,
      approach_pct: 5,
      reduce_to_pct: 5,
      enabled: true,
    }, { type: 'reached', currentPrice: 40.25, targetPrice: 40 });
    expect(notification.title).toContain('FNGU');
    expect(notification.title).toContain('到达');
    expect(notification.body).toContain('清仓或减到 ≤5%');
    expect(notification.body).toContain('只提醒不下单');
    expect(notification.body).toContain('手动执行');

    const url = buildBarkPushUrl({
      baseUrl: 'https://api.day.app/',
      deviceKey: 'fake/key ?',
      title: notification.title,
      body: notification.body,
    });
    expect(url).toContain(encodeURIComponent('fake/key ?'));
    expect(url).toContain(encodeURIComponent(notification.title));
    expect(url).toContain(encodeURIComponent(notification.body));

    const gainNotification = formatAlertNotification({
      id: 'nvda-gain',
      symbol: 'NVDA',
      type: 'gain_pct',
      cost_basis: 100,
      gain_pct: 20,
      approach_pct: 5,
      enabled: true,
    }, { type: 'reached', currentPrice: 121, targetPrice: 120 });
    expect(gainNotification.body).toContain('卖出 50% 仓位，留 50% 博弈');
  });

  it('retries exactly once and never leaks the Bark key through errors or logs', async () => {
    const deviceKey = 'unit-secret-device-key';
    const requestedUrls: string[] = [];
    const logMessages: string[] = [];
    let thrown: unknown;
    try {
      await sendBarkNotification({
        baseUrl: 'https://api.day.app',
        deviceKey,
        title: 'FNGU 到达',
        body: '只提醒不下单',
        fetchImpl: async (url) => {
          requestedUrls.push(String(url));
          return new Response('upstream failed', { status: 500 });
        },
        logError: (message) => logMessages.push(message),
      });
    } catch (error) {
      thrown = error;
    }
    expect(requestedUrls).toHaveLength(2);
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).not.toContain(deviceKey);
    expect(logMessages.join('\n')).not.toContain(deviceKey);
  });
});
