import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNotificationControl, defaultNotificationSettings, defaultDeliveryWindow, inDeliveryWindow, inQuietHours, notificationPermission,
  scheduleDue, validateNotificationSettings } from './notification-control.mjs';

const roots: string[] = []; const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise(resolve => s.close(resolve)))); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const at = '2026-09-14T13:20:00Z';
const preferences = () => ({ ...defaultNotificationSettings(), enabled: true, quietHours: { enabled: false, start: '22:00', end: '08:00', timeZone: 'Asia/Shanghai' } });
async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'notification-test-')); roots.push(root);
  let time = new Date(at); const send = vi.fn(async () => true);
  const control = createNotificationControl({ root, token: 'internal-only', send, now: () => time,
    sendJson: (res: import('node:http').ServerResponse, code: number, data: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); } });
  const server = createServer(async (req, res) => { await control.route(new URL(req.url || '/', 'http://localhost'), req, res); });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); const origin = `http://127.0.0.1:${typeof address === 'object' ? address?.port : 0}`;
  const get = async () => (await fetch(origin + '/api/notifications/settings')).json();
  const put = (data: unknown, headers = {}) => fetch(origin + '/api/notifications/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Notification-Settings': '1', ...headers }, body: JSON.stringify(data) });
  return { root, control, send, origin, get, put, advance: (ms: number) => { time = new Date(+time + ms); } };
}
describe('notification preferences and send-time authority', () => {
  it('hydrates time windows and default ±1.4 without changing legacy saved switches or revision', async () => {
    const h = await harness(); const legacy = preferences(); delete legacy.zExtreme; delete legacy.eventWindows;
    legacy.events.risk = false;
    await writeFile(join(h.root, 'notification-settings.json'), JSON.stringify(legacy));
    const s = await h.control.settings();
    expect(s.zExtreme).toEqual({ enabled: false, positive: false, negative: false, positiveThreshold: 1.4, negativeThreshold: 1.4 });
    expect(Object.keys(s.eventWindows)).toHaveLength(11); expect(s.eventWindows.trade.enabled).toBe(false);
    expect(s.events.risk).toBe(false); expect(s.revision).toBe(legacy.revision);
    const { readFile } = await import('node:fs/promises');
    expect(JSON.parse(await readFile(join(h.root, 'notification-settings.json'), 'utf8')).zExtreme).toBeUndefined();
  });
  it('validates custom thresholds and each window; omitted fields retain prior values', () => {
    const p = preferences(); p.zExtreme.positiveThreshold = 1.7;
    p.eventWindows.trade = { ...defaultDeliveryWindow(), enabled: true, start: '09:30', end: '16:00', days: [1, 2] };
    const omitted = { ...p }; delete omitted.zExtreme; delete omitted.eventWindows;
    const s = validateNotificationSettings(omitted, p); expect(s.zExtreme.positiveThreshold).toBe(1.7); expect(s.eventWindows.trade).toEqual(p.eventWindows.trade);
    for (const threshold of [0, -1, 10.1, NaN, Infinity, '1.4']) expect(() => validateNotificationSettings({ ...p, zExtreme: { ...p.zExtreme, positiveThreshold: threshold } }, p)).toThrow();
    for (const patch of [{ start: '25:00' }, { end: '09:30' }, { days: [] }, { days: [7] }, { timeZone: 'bad' }]) expect(() => validateNotificationSettings({ ...p, eventWindows: { trade: { ...p.eventWindows.trade, ...patch } } }, p)).toThrow();
    expect(() => validateNotificationSettings({ ...p, eventWindows: { invalid: defaultDeliveryWindow() } }, p)).toThrow();
  });
  it('handles start-inclusive/end-exclusive, weekdays and overnight windows anchored to the start day', () => {
    const w = { enabled: true, start: '22:00', end: '02:00', timeZone: 'UTC', days: [1] };
    expect(inDeliveryWindow(w, new Date('2026-09-14T22:00:00Z'))).toBe(true);
    expect(inDeliveryWindow(w, new Date('2026-09-15T01:59:59Z'))).toBe(true);
    expect(inDeliveryWindow(w, new Date('2026-09-15T02:00:00Z'))).toBe(false);
    expect(inDeliveryWindow(w, new Date('2026-09-14T01:00:00Z'))).toBe(false);
    expect(inDeliveryWindow(w, new Date('2026-09-15T22:00:00Z'))).toBe(false);
    expect(inDeliveryWindow({ ...w, enabled: false }, new Date('2026-09-15T22:00:00Z'))).toBe(true);
  });
  it('uses named time zones across summer/winter and DST transitions', () => {
    const w = { ...defaultDeliveryWindow(), enabled: true, start: '09:00', end: '10:00', timeZone: 'America/New_York' };
    expect(inDeliveryWindow(w, new Date('2026-07-14T13:30:00Z'))).toBe(true);
    expect(inDeliveryWindow(w, new Date('2026-01-14T13:30:00Z'))).toBe(false);
    expect(inDeliveryWindow(w, new Date('2026-01-14T14:30:00Z'))).toBe(true);
    const fallback = { ...w, start: '01:00', end: '02:00' };
    expect(inDeliveryWindow(fallback, new Date('2026-11-01T05:30:00Z'))).toBe(true);
    expect(inDeliveryWindow(fallback, new Date('2026-11-01T06:30:00Z'))).toBe(true);
  });
  it('checks every category and special direction independently; global/quiet-hours remain stronger', () => {
    const p = preferences(); const outside = { ...defaultDeliveryWindow(), enabled: true, start: '01:00', end: '02:00', timeZone: 'UTC' };
    for (const category of ['trade', 'valuation', 'risk', 'data', 'system']) {
      p.eventWindows[category] = outside;
      expect(notificationPermission(p, { category, createdAt: at }, new Date(at))).toBe('outside_allowed_window');
      p.eventWindows[category] = defaultDeliveryWindow();
      expect(notificationPermission(p, { category, createdAt: at }, new Date(at))).toBeNull();
    }
    p.breakout = { enabled: true, up: true, down: true }; p.eventWindows.breakout_up = outside;
    const e = { category: 'breakout', direction: 'up', createdAt: at, occurredAt: at };
    expect(notificationPermission(p, e, new Date(at))).toBe('outside_allowed_window');
    expect(notificationPermission(p, { ...e, direction: 'down' }, new Date(at))).toBeNull();
    p.eventWindows.breakout = outside;
    expect(notificationPermission(p, { ...e, direction: 'down' }, new Date(at))).toBe('outside_allowed_window');
    expect(notificationPermission({ ...p, enabled: false }, e, new Date(at))).toBe('disabled');
  });
  it('requires confirmed extreme, current threshold, direction and both family/direction windows', () => {
    const p = preferences(); const e = { category: 'zExtreme', direction: 'positive', confirmed: true, threshold: 1.4, createdAt: at, occurredAt: at };
    expect(notificationPermission(p, e, new Date(at))).toBe('extreme_disabled');
    p.zExtreme.enabled = true; expect(notificationPermission(p, e, new Date(at))).toBe('extreme_direction_disabled');
    p.zExtreme.positive = true; expect(notificationPermission(p, e, new Date(at))).toBeNull();
    expect(notificationPermission(p, { ...e, confirmed: false }, new Date(at))).toBe('extreme_unconfirmed');
    expect(notificationPermission(p, { ...e, threshold: 1.5 }, new Date(at))).toBe('extreme_rule_changed');
    expect(notificationPermission({ ...p, deliveryEpoch: at }, { ...e, occurredAt: '2026-09-13T20:20:00Z' }, new Date(at))).toBe('before_settings_change');
    for (const key of ['zExtreme', 'zExtreme_positive']) {
      p.eventWindows[key] = { ...defaultDeliveryWindow(), enabled: true, start: '01:00', end: '02:00', timeZone: 'UTC' };
      expect(notificationPermission(p, e, new Date(at))).toBe('outside_allowed_window'); p.eventWindows[key] = defaultDeliveryWindow();
    }
    p.quietHours = { enabled: true, start: '13:00', end: '14:00', timeZone: 'UTC' };
    expect(notificationPermission(p, e, new Date(at))).toBe('quiet_hours');
  });
  it('persists independent windows and never queues a message blocked outside its window', async () => {
    const h = await harness(); const p = preferences();
    p.eventWindows.trade = { ...defaultDeliveryWindow(), enabled: true, start: '13:21', end: '14:00', timeZone: 'UTC' };
    expect((await h.put({ ...(await h.get()).settings, ...p })).status).toBe(200);
    const event = { category: 'trade', title: 'test', body: 'test', dedupeKey: 'window-one', createdAt: at };
    expect((await h.control.dispatch(event)).reason).toBe('outside_allowed_window'); expect(h.send).not.toHaveBeenCalled();
    h.advance(60000); expect((await h.control.dispatch({ ...event, createdAt: '2026-09-14T13:21:00Z' })).status).toBe('deduplicated');
    const restart = createNotificationControl({ root: h.root, send: h.send, now: () => new Date('2026-09-14T13:21:00Z') });
    expect((await restart.settings()).eventWindows.trade.start).toBe('13:21');
    expect((await restart.dispatch({ ...event, createdAt: '2026-09-14T13:21:00Z', dedupeKey: 'window-two' })).status).toBe('sent');
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it('keeps all new breakout switches off and hydrates old saved settings without rewriting them', async () => {
    const h = await harness();
    const old = preferences(); delete old.breakout;
    await writeFile(join(h.root, 'notification-settings.json'), JSON.stringify(old));
    const value = await h.control.settings();
    expect(value.breakout).toEqual({ enabled: false, up: false, down: false });
    expect(value.enabled).toBe(true); expect(value.revision).toBe(old.revision);
    const { readFile } = await import('node:fs/promises');
    expect(JSON.parse(await readFile(join(h.root, 'notification-settings.json'), 'utf8')).breakout).toBeUndefined();
    expect(() => validateNotificationSettings({ ...value, breakout: { enabled: true, up: 'true', down: false } }, value)).toThrow();
  });
  it('requires global, breakout, direction, quiet-hours and occurrence barriers independently', () => {
    const event = { category: 'breakout', direction: 'down', createdAt: at, occurredAt: at };
    const p = preferences();
    expect(notificationPermission(p, event, new Date(at))).toBe('breakout_disabled');
    p.breakout = { enabled: true, up: true, down: false };
    expect(notificationPermission(p, event, new Date(at))).toBe('breakout_direction_disabled');
    p.breakout.down = true; p.events.trade = false;
    expect(notificationPermission(p, event, new Date(at))).toBeNull();
    expect(notificationPermission({ ...p, enabled: false }, event, new Date(at))).toBe('disabled');
    expect(notificationPermission({ ...p, quietHours: { ...p.quietHours, enabled: true, start: '21:00', end: '22:00' } }, event, new Date(at))).toBe('quiet_hours');
    expect(notificationPermission({ ...p, deliveryEpoch: at }, { ...event, occurredAt: '2026-09-13T20:20:00Z' }, new Date(at))).toBe('before_settings_change');
    expect(notificationPermission(p, { ...event, occurredAt: null }, new Date(at))).toBe('breakout_unconfirmed');
  });
  it('persists breakout preferences and permanently consumes suppressed events without phone transport', async () => {
    const h = await harness();
    const event = { category: 'breakout', direction: 'down', dedupeKey: 'AMZN:2026-09-14:down', title: 'mock', body: 'mock', createdAt: at, occurredAt: at };
    await h.control.dispatch(event); expect(h.send).not.toHaveBeenCalled();
    await h.put({ ...(await h.get()).settings, ...preferences(), breakout: { enabled: true, up: false, down: true } });
    expect((await h.control.dispatch(event)).status).toBe('deduplicated');
    expect((await h.control.dispatch({ ...event, dedupeKey: 'new-event' })).status).toBe('sent');
    expect(h.send).toHaveBeenCalledTimes(1);
    const restart = createNotificationControl({ root: h.root, send: h.send, now: () => new Date(at) });
    expect((await restart.settings()).breakout).toEqual({ enabled: true, up: false, down: true });
    expect((await restart.dispatch({ ...event, dedupeKey: 'new-event' })).status).toBe('deduplicated');
  });
  it('defaults to OFF, includes every legacy report, and enforces P0/heartbeat quiet hours', () => {
    const value = defaultNotificationSettings();
    expect(value.enabled).toBe(false); expect(value.schedules).toHaveLength(14);
    expect(notificationPermission(value, { category: 'system_p0' }, new Date(at))).toBe('disabled');
    value.enabled = true;
    expect(notificationPermission(value, { category: 'system_p0' }, new Date('2026-09-14T16:00:00Z'))).toBe('quiet_hours');
    expect(notificationPermission(value, { category: 'system', key: 'heartbeat:today' }, new Date('2026-09-15T00:00:00Z'))).toBeNull();
  });
  it('handles cross-midnight, inclusive start/exclusive end, and DST', () => {
    const value = preferences(); value.quietHours.enabled = true;
    expect(inQuietHours(value, new Date('2026-09-14T14:00:00Z'))).toBe(true);
    expect(inQuietHours(value, new Date('2026-09-14T23:59:59Z'))).toBe(true);
    expect(inQuietHours(value, new Date('2026-09-15T00:00:00Z'))).toBe(false);
    value.quietHours = { enabled: true, start: '09:00', end: '17:00', timeZone: 'America/New_York' };
    expect(inQuietHours(value, new Date('2026-07-14T13:00:00Z'))).toBe(true);
    expect(inQuietHours(value, new Date('2026-01-14T13:00:00Z'))).toBe(false);
  });
  it('validates all fields and prevents arbitrary worker code/schedule injection', () => {
    const p = preferences();
    expect(() => validateNotificationSettings({ ...p, enabled: 'false' }, p)).toThrow();
    expect(() => validateNotificationSettings({ ...p, schedules: [] }, p)).toThrow();
    expect(() => validateNotificationSettings({ ...p, quietHours: { ...p.quietHours, timeZone: 'evil' } }, p)).toThrow();
    expect(() => validateNotificationSettings({ ...p, schedules: [...p.schedules, { ...p.schedules[0], id: 'custom-x', kind: 'exec_shell' }] }, p)).toThrow();
    const custom = { ...p.schedules[0], id: 'custom-x', time: '09:10', name: '<script>', source: 'evil' };
    const result = validateNotificationSettings({ ...p, schedules: [...p.schedules, custom] }, p);
    expect(result.schedules.at(-1).source).toBe('server'); expect(result.schedules.at(-1).name).not.toBe('<script>');
  });
  it('uses chosen weekdays and month days without replay windows', () => {
    const row = preferences().schedules[0];
    expect(scheduleDue(row, new Date(at))).toBe(true);
    expect(scheduleDue(row, new Date('2026-09-14T13:25:00Z'))).toBe(false);
    expect(scheduleDue({ ...row, enabled: false }, new Date(at))).toBe(false);
    expect(scheduleDue({ ...row, days: [0] }, new Date(at))).toBe(false);
    expect(scheduleDue({ ...row, dayOfMonth: 1 }, new Date(at))).toBe(false);
  });
  it('allows password-free UI changes, persists across restarts, and rejects stale devices/CSRF', async () => {
    const h = await harness();
    const initial = (await h.get()).settings;
    expect(initial.enabled).toBe(false);
    const update = { ...initial, events: { ...initial.events, trade: false } };
    expect((await h.put(update)).status).toBe(200);
    expect((await h.put(update)).status).toBe(409);
    const current = (await h.get()).settings;
    expect((await h.put(current, { Origin: 'https://evil.test' })).status).toBe(403);
    const restart = createNotificationControl({ root: h.root, send: h.send });
    expect((await restart.settings()).events.trade).toBe(false);
    expect((await fetch(h.origin + '/api/notifications/relay', { method: 'POST', body: '{}' })).status).toBe(401);
  });
  it('suppresses disabled messages permanently and enforces category and schedule checks at dispatch', async () => {
    const h = await harness();
    const event = { title: 'test', body: 'no real transport', category: 'system_p0', dedupeKey: 'p0-one', createdAt: at };
    expect((await h.control.dispatch(event)).status).toBe('suppressed'); expect(h.send).not.toHaveBeenCalled();
    const value = (await h.get()).settings;
    await h.put({ ...value, ...preferences() });
    expect((await h.control.dispatch(event)).status).toBe('deduplicated');
    expect((await h.control.dispatch({ ...event, dedupeKey: 'p0-two' })).status).toBe('sent');
    const current = (await h.get()).settings;
    await h.put({ ...current, events: { ...current.events, data: false } });
    expect((await h.control.dispatch({ ...event, dedupeKey: 'p0-three' })).reason).toBe('category_disabled');
    expect((await h.control.dispatch({ ...event, category: 'trade', dedupeKey: 'bad-slot', scheduleId: 'nonexistent' })).reason).toBe('schedule_disabled_or_outside_window');
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it('rejects old messages after reenable, malformed files fail closed, and concurrent changes have one winner', async () => {
    const h = await harness(); const initial = (await h.get()).settings;
    const results = await Promise.all([h.put({ ...initial, enabled: true }), h.put({ ...initial, enabled: true })]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    h.advance(180000);
    expect((await h.control.dispatch({ dedupeKey: 'old', createdAt: at })).reason).toBe('expired');
    await writeFile(join(h.root, 'notification-settings.json'), '{broken');
    await expect(h.control.dispatch({ dedupeKey: 'corrupt' })).rejects.toThrow();
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe('第三阶段：实时提醒开关', () => {
  it('老设置文件没有 realtime 时，读出来是全部关闭', () => {
    const base = defaultNotificationSettings();
    delete (base as { realtime?: unknown }).realtime;

    const validated = validateNotificationSettings(base, base, new Date('2026-10-16T00:00:00.000Z'));

    expect(validated.realtime).toMatchObject({ enabled: false, qqqDrawdown: false, vix: false, importantRepeat: 3 });
  });

  it('保存时保留用户打开的开关', () => {
    const base = defaultNotificationSettings();
    const input = { ...base, realtime: { ...base.realtime, enabled: true, qqqDrawdown: true, importantRepeat: 2 } };

    const validated = validateNotificationSettings(input, base, new Date('2026-10-16T00:00:00.000Z'));

    expect(validated.realtime).toMatchObject({ enabled: true, qqqDrawdown: true, vix: false, importantRepeat: 2 });
  });
});
