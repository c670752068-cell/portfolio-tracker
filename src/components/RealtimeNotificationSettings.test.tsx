import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RealtimeNotificationSettings } from './NotificationEventSettings';
import { defaultRealtimeNotification, type NotificationSettings } from '../notificationSettings';

function settings(overrides: Partial<NotificationSettings> = {}): NotificationSettings {
  return {
    version: 1, revision: 3, enabled: true, updatedAt: null, deliveryEpoch: null,
    quietHours: { enabled: true, start: '22:00', end: '08:00', timeZone: 'Asia/Shanghai' },
    events: { trade: true, valuation: true, risk: true, data: true, system: true },
    schedules: [], ...overrides,
  } as NotificationSettings;
}

describe('设置里的实时提醒分组', () => {
  it('七个开关默认全关，连发次数默认 3', () => {
    const defaults = defaultRealtimeNotification();
    expect(defaults).toMatchObject({
      enabled: false, qqqDrawdown: false, vix: false, cnn: false,
      intradayZ: false, bigMove: false, sellLine: false, holdings: false, resonance: false,
      importantRepeat: 3,
    });

    const html = renderToStaticMarkup(
      <RealtimeNotificationSettings settings={settings()} disabled={false} onSave={async () => true} />,
    );

    expect(html).toContain('实时提醒');
    for (const label of ['QQQ 回撤', 'VIX', '恐慌指数', '盘中 Z-Score', '卖出线', '持仓变化', '多指标共振']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('重要提醒连发次数');
    expect(html).toContain('默认关闭');
    // 所有开关都是关着的
    expect(html).not.toContain('notification-switch checked');
  });

  it('打开总开关后分项才可用', () => {
    const on = settings({ realtime: { ...defaultRealtimeNotification(), enabled: true, qqqDrawdown: true } } as Partial<NotificationSettings>);
    const html = renderToStaticMarkup(
      <RealtimeNotificationSettings settings={on} disabled={false} onSave={async () => true} />,
    );

    expect(html).toContain('notification-switch checked');
    expect(html).toContain('aria-checked="true"');
  });

  it('说明里写清楚免打扰沿用现有设置', () => {
    const html = renderToStaticMarkup(
      <RealtimeNotificationSettings settings={settings()} disabled={false} onSave={async () => true} />,
    );

    expect(html).toContain('免打扰');
    expect(html).toContain('只记日志');
  });
});
