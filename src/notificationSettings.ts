import { getServerNotificationSettingsUrl } from './runtimeConfig';

export type NotificationCategory = 'trade' | 'valuation' | 'risk' | 'data' | 'system';
export type NotificationWindowKey = NotificationCategory | 'breakout' | 'breakout_up' | 'breakout_down' | 'zExtreme' | 'zExtreme_positive' | 'zExtreme_negative';
export interface NotificationWindow { enabled: boolean; start: string; end: string; timeZone: string; days: number[] }
export interface ExtremeNotificationSettings { enabled: boolean; positive: boolean; negative: boolean; positiveThreshold: number; negativeThreshold: number }
export const defaultNotificationWindow = (): NotificationWindow => ({ enabled: false, start: '08:00', end: '22:00', timeZone: 'Asia/Shanghai', days: [0, 1, 2, 3, 4, 5, 6] });
export const defaultExtremeNotification = (): ExtremeNotificationSettings => ({ enabled: false, positive: false, negative: false, positiveThreshold: 1.4, negativeThreshold: 1.4 });
export interface NotificationSchedule {
  id: string; name: string; description: string; source: 'server' | 'worker'; kind: string;
  enabled: boolean; time: string; timeZone: string; days: number[]; dayOfMonth: number | null; custom: boolean;
}
export interface NotificationSettings {
  version: 1; revision: number; enabled: boolean; updatedAt: string | null; deliveryEpoch: string | null;
  quietHours: { enabled: boolean; start: string; end: string; timeZone: string };
  events: Record<NotificationCategory, boolean>; schedules: NotificationSchedule[];
  breakout?: { enabled: boolean; up: boolean; down: boolean };
  zExtreme?: ExtremeNotificationSettings;
  eventWindows?: Partial<Record<NotificationWindowKey, NotificationWindow>>;
  realtime?: RealtimeNotificationSettingsValue;
}

/** 第三阶段新增的实时提醒开关，全部默认关闭，由用户自己在设置里打开。 */
export interface RealtimeNotificationSettingsValue {
  enabled: boolean;
  qqqDrawdown: boolean;
  vix: boolean;
  cnn: boolean;
  intradayZ: boolean;
  bigMove: boolean;
  sellLine: boolean;
  holdings: boolean;
  resonance: boolean;
  importantRepeat: 1 | 2 | 3;
  quietSummary: boolean;
}

export function defaultRealtimeNotification(): RealtimeNotificationSettingsValue {
  return {
    enabled: false, qqqDrawdown: false, vix: false, cnn: false, intradayZ: false,
    bigMove: false, sellLine: false, holdings: false, resonance: false,
    importantRepeat: 3, quietSummary: true,
  };
}
export interface NotificationStatus {
  settings: NotificationSettings; state: 'on' | 'off' | 'quiet'; serverTime: string; workerSeenAt: string | null;
  eventTypes: { id: NotificationCategory; name: string; description: string }[];
}
export const NOTIFICATION_ZONES = [
  ['Asia/Shanghai', '北京时间（UTC+8）'], ['America/New_York', '美东时间（自动夏令时）'],
  ['America/Los_Angeles', '美西时间（自动夏令时）'], ['UTC', '世界标准时间（UTC）'],
] as const;
export const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
export function scheduleRepeatText(schedule: NotificationSchedule) {
  const days = schedule.days.length === 7 ? '每天' : schedule.days.join(',') === '1,2,3,4,5' ? '周一至周五' : schedule.days.map(day => `周${WEEKDAY_NAMES[day]}`).join('、');
  return schedule.dayOfMonth ? `每月 ${schedule.dayOfMonth} 日 · ${days}` : days;
}
export async function fetchNotificationSettings(next?: NotificationSettings): Promise<NotificationStatus> {
  const url = getServerNotificationSettingsUrl();
  if (!url) throw new Error('此页面尚未连接通知服务器');
  const response = await fetch(url, { method: next ? 'PUT' : 'GET', cache: 'no-store',
    headers: next ? { 'Content-Type': 'application/json', 'X-Notification-Settings': '1' } : undefined,
    body: next ? JSON.stringify(next) : undefined, signal: AbortSignal.timeout(15000) });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : '通知设置暂不可用，请重试');
  if (!value.settings || !Array.isArray(value.settings.schedules)) throw new Error('通知服务器返回了无效数据');
  return value;
}
