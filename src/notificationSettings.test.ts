import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNotificationSettings, scheduleRepeatText, type NotificationSchedule } from './notificationSettings';
afterEach(() => vi.unstubAllGlobals());
describe('notification settings client', () => {
  it('shows explicit repeat days', () => {
    expect(scheduleRepeatText({ days: [1, 2, 3, 4, 5], dayOfMonth: null } as NotificationSchedule)).toBe('周一至周五');
    expect(scheduleRepeatText({ days: [0], dayOfMonth: null } as NotificationSchedule)).toBe('周日');
  });
  it('does not silently fall back to browser settings on errors', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://myopenid.top' }, __PORTFOLIO_TRACKER_RUNTIME__: { apiBaseUrl: 'https://myopenid.top' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '其他设备已修改设置，请刷新后重试' }), { status: 409 })));
    await expect(fetchNotificationSettings()).rejects.toThrow('其他设备已修改');
  });
});
