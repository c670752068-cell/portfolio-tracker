import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NotificationEventSettings } from './NotificationEventSettings';
import type { NotificationSettings, NotificationStatus } from '../notificationSettings';
const settings: NotificationSettings = { version: 1, revision: 0, enabled: false, updatedAt: null, deliveryEpoch: null,
  quietHours: { enabled: true, start: '22:00', end: '08:00', timeZone: 'Asia/Shanghai' },
  schedules: [], events: { trade: true, valuation: true, risk: true, data: true, system: true } };
const eventTypes: NotificationStatus['eventTypes'] = (['trade', 'valuation', 'risk', 'data', 'system'] as const).map(id => ({ id, name: id, description: id }));
describe('each notification column has an independent time editor', () => {
  it('includes default ±1.4, 11 collapsed window editors, and keeps the new switches off', () => {
    const html = renderToStaticMarkup(<NotificationEventSettings settings={settings} eventTypes={eventTypes} disabled={false} onSave={async () => true} />);
    expect(html.match(/允许发送时段"/g)).toHaveLength(11);
    expect(html).toContain('Z-Score 极值附近提醒'); expect(html.match(/value="1.4"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-label="Z-Score极值附近提醒" aria-checked="false"/);
    expect(html).toContain('时段外不发、不排队'); expect(html).toContain('允许时段不移动审查时间');
    expect(html).toContain('向上露头提醒允许发送时段'); expect(html).toContain('负值阈值提醒允许发送时段');
  });
});
