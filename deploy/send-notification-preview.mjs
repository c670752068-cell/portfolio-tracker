import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildNotificationPreviewEvents } from './notification-copy.mjs';
import { sendBarkNotification } from './alert-tracker.mjs';

const deviceKey = process.env.BARK_DEVICE_KEY || '';
const baseUrl = process.env.BARK_BASE_URL || 'https://api.day.app';
if (!deviceKey) throw new Error('BARK_DEVICE_KEY is required');

const snapshotPath = process.env.FUTU_ASSISTANT_SITE_EXPORT
  || join(homedir(), 'Projects/futu-assistant/data/site_export.json');
const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
const events = buildNotificationPreviewEvents(snapshot);
for (const [index, item] of events.entries()) {
  const title = `【示例模板 ${index + 1}/${events.length}】${item.title}`;
  await sendBarkNotification({ baseUrl, deviceKey, title, body: `示例演示｜${item.body}` });
  console.log(`sent ${index + 1}/${events.length}: ${item.title}`);
}
