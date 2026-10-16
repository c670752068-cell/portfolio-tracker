// One server-side authority for website and workstation phone notifications.
// Public preference editing is intentional; relay credentials never leave the server.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { mergeRealtimeSettings, realtimeDefaults } from './realtime-push.mjs';
import { join } from 'node:path';

export const TIME_ZONES = ['Asia/Shanghai', 'America/New_York', 'America/Los_Angeles', 'UTC'];
export const EVENT_TYPES = [
  { id: 'trade', name: '买卖信号', description: '买入、卖出、深回撤和通道/目标价提醒。' },
  { id: 'valuation', name: '估值提醒', description: '估值进入关注区间；不改变回撤优先的买入规则。' },
  { id: 'risk', name: '风险提醒', description: '仓位、相关性、财报保护、波动风险与纪律拦截。' },
  { id: 'data', name: '数据与连接异常', description: '行情、券商连接和计算异常（含原 P0 告警）。' },
  { id: 'system', name: '状态与其他提醒', description: '观察状态变化及其他系统消息；不设绕过总开关的例外。' },
];
export const WINDOW_KEYS = [...EVENT_TYPES.map(item => item.id), 'breakout', 'breakout_up', 'breakout_down', 'zExtreme', 'zExtreme_positive', 'zExtreme_negative'];
export const defaultDeliveryWindow = () => ({ enabled: false, start: '08:00', end: '22:00', timeZone: 'Asia/Shanghai', days: [0, 1, 2, 3, 4, 5, 6] });
export const defaultExtremeSettings = () => ({ enabled: false, positive: false, negative: false, positiveThreshold: 1.4, negativeThreshold: 1.4 });
const weekdays = [1, 2, 3, 4, 5];
const daily = [0, 1, 2, 3, 4, 5, 6];
const template = (id, name, description, source, kind, time, timeZone, days = weekdays, dayOfMonth = null) => ({
  id, name, description, source, kind, enabled: true, time, timeZone, days, dayOfMonth, custom: false,
});
export const SCHEDULE_TEMPLATES = [
  template('decision-premarket', '盘前决策提醒', '按最新网站决策检查买卖、估值与仓位机会；仅交易日。', 'server', 'decision', '21:20', 'Asia/Shanghai'),
  template('decision-open', '开盘决策提醒', '与网页最终裁决保持一致；仅交易日，不执行交易。', 'server', 'decision', '22:00', 'Asia/Shanghai'),
  template('morning-digest', '晨间市场汇总', '当前市场与机会摘要；不补发夜间积压消息。原时间为早上 08:00。', 'worker', 'morning_digest', '08:00', 'Asia/Shanghai', daily),
  template('morning-discipline', '开盘前纪律检查', '检查当前持仓和交易纪律；仅美股交易日。', 'worker', 'morning', '09:20', 'America/New_York'),
  template('close-report', '收盘检查', '收盘后持仓、信号与当日总结；仅美股交易日。', 'worker', 'close', '16:10', 'America/New_York'),
  template('system-heartbeat', '系统运行报告', '券商连接、行情和持仓快照的运行状态；仅交易日。', 'worker', 'heartbeat', '09:00', 'America/New_York'),
  template('ibkr-reconciliation', '持仓核对提醒', '券商成交与持仓纪律核对；仅交易日。', 'worker', 'reconciliation', '08:30', 'America/New_York'),
  template('weekly-discipline', '每周纪律与纸面组合报告', '汇总过去一周的交易纪律和纸面组合表现。', 'worker', 'weekly', '18:00', 'America/New_York', [0]),
  template('signal-monthly', '信号月度成绩单', '统计已有信号的后续表现；默认每月 1 日。', 'worker', 'monthly', '18:30', 'America/New_York', daily, 1),
  ...['10:00', '18:00', '21:40'].map(time => template(`drawdown-${time.replace(':', '')}`, '三倍回撤日报', 'TQQQ、FNGU、SOXL、FAS 回撤统计和当前深度。', 'worker', 'drawdown_summary', time, 'Asia/Shanghai', daily)),
  template('panic-overnight', '夜盘风险预览', '夜盘风险情景预览；无有效行情时不发送。', 'worker', 'panic_overnight', '10:00', 'Asia/Shanghai', daily),
  template('panic-premarket', '盘前风险预览', '盘前风险情景预览；无有效行情时不发送。', 'worker', 'panic_premarket', '21:00', 'Asia/Shanghai', daily),
];

export function defaultNotificationSettings() {
  return { version: 1, revision: 0, enabled: false, updatedAt: null, deliveryEpoch: null,
    quietHours: { enabled: true, start: '22:00', end: '08:00', timeZone: 'Asia/Shanghai' },
    events: Object.fromEntries(EVENT_TYPES.map(item => [item.id, true])),
    breakout: { enabled: false, up: false, down: false },
    zExtreme: defaultExtremeSettings(),
    eventWindows: Object.fromEntries(WINDOW_KEYS.map(key => [key, defaultDeliveryWindow()])),
    // 第三阶段新增的实时提醒开关，全部默认关闭，由用户自己打开。
    realtime: realtimeDefaults(),
    schedules: structuredClone(SCHEDULE_TEMPLATES) };
}
const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
function requireValue(condition, message) { if (!condition) throw new Error(message); }
export function validateNotificationSettings(input, previous, now = new Date()) {
  requireValue(input && typeof input === 'object', '设置格式不正确');
  requireValue(typeof input.enabled === 'boolean', '总开关必须为开启或关闭');
  const q = input.quietHours;
  requireValue(q && typeof q.enabled === 'boolean' && validTime(q.start) && validTime(q.end)
    && TIME_ZONES.includes(q.timeZone) && q.start !== q.end, '请填写有效免打扰时间（开始与结束不能相同）');
  requireValue(input.events && EVENT_TYPES.every(item => typeof input.events[item.id] === 'boolean'), '推送类别不完整');
  const breakout = input.breakout ?? previous.breakout ?? { enabled: false, up: false, down: false };
  requireValue(breakout && ['enabled', 'up', 'down'].every(key => typeof breakout[key] === 'boolean'), '露头推送开关无效');
  const zExtreme = input.zExtreme ?? previous.zExtreme ?? defaultExtremeSettings();
  requireValue(zExtreme && ['enabled', 'positive', 'negative'].every(key => typeof zExtreme[key] === 'boolean')
    && ['positiveThreshold', 'negativeThreshold'].every(key => typeof zExtreme[key] === 'number' && Number.isFinite(zExtreme[key]) && zExtreme[key] >= 0.1 && zExtreme[key] <= 10), '极值提醒阈值应为 0.1–10，开关须有效');
  const suppliedWindows = input.eventWindows ?? previous.eventWindows ?? {};
  requireValue(suppliedWindows && typeof suppliedWindows === 'object' && !Array.isArray(suppliedWindows)
    && Object.keys(suppliedWindows).every(key => WINDOW_KEYS.includes(key)), '推送时段栏目无效');
  const eventWindows = Object.fromEntries(WINDOW_KEYS.map(key => {
    const w = suppliedWindows[key] ?? previous.eventWindows?.[key] ?? defaultDeliveryWindow();
    requireValue(w && typeof w.enabled === 'boolean' && validTime(w.start) && validTime(w.end) && w.start !== w.end
      && TIME_ZONES.includes(w.timeZone) && Array.isArray(w.days) && w.days.length > 0 && w.days.length <= 7
      && w.days.every(day => Number.isInteger(day) && day >= 0 && day <= 6), '请填写有效允许时段、时区和重复星期（开始与结束不能相同）');
    return [key, { enabled: w.enabled, start: w.start, end: w.end, timeZone: w.timeZone, days: [...new Set(w.days)].sort() }];
  }));
  requireValue(Array.isArray(input.schedules) && input.schedules.length <= 40, '最多设置 40 个定时任务');
  const seen = new Set();
  const schedules = input.schedules.map(item => {
    const base = SCHEDULE_TEMPLATES.find(t => t.id === item.id);
    const model = base || SCHEDULE_TEMPLATES.find(t => t.kind === item.kind);
    requireValue(model && typeof item.id === 'string' && /^[a-z0-9-]{1,64}$/.test(item.id) && !seen.has(item.id), '定时任务无效或重复');
    seen.add(item.id);
    requireValue(base || item.id.startsWith('custom-'), '新增任务编号不正确');
    requireValue(typeof item.enabled === 'boolean' && validTime(item.time) && TIME_ZONES.includes(item.timeZone), '定时任务时间无效');
    requireValue(Array.isArray(item.days) && item.days.length > 0 && item.days.length <= 7
      && item.days.every(day => Number.isInteger(day) && day >= 0 && day <= 6), '请选择有效重复星期');
    requireValue(item.dayOfMonth === null || (Number.isInteger(item.dayOfMonth) && item.dayOfMonth >= 1 && item.dayOfMonth <= 28), '每月日期应为 1–28 日');
    return { ...model, id: item.id, custom: !base, enabled: item.enabled, time: item.time,
      timeZone: item.timeZone, days: [...new Set(item.days)].sort(), dayOfMonth: item.dayOfMonth };
  });
  requireValue(SCHEDULE_TEMPLATES.every(t => seen.has(t.id)), '原有任务请用开关关闭，不能删除');
  return { version: 1, revision: previous.revision + 1, enabled: input.enabled, updatedAt: now.toISOString(),
    // A settings change is a delivery barrier, never a reason to replay old messages.
    deliveryEpoch: now.toISOString(), quietHours: { enabled: q.enabled, start: q.start, end: q.end, timeZone: q.timeZone },
    events: Object.fromEntries(EVENT_TYPES.map(item => [item.id, input.events[item.id]])),
    breakout: { enabled: breakout.enabled, up: breakout.up, down: breakout.down },
    zExtreme: { enabled: zExtreme.enabled, positive: zExtreme.positive, negative: zExtreme.negative, positiveThreshold: zExtreme.positiveThreshold, negativeThreshold: zExtreme.negativeThreshold },
    // 缺字段时补默认值（全关），不会动用户已有的其他设置
    realtime: mergeRealtimeSettings({ realtime: input.realtime }).realtime,
    eventWindows, schedules };
}
export function zonedParts(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(date).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`,
    minutes: +parts.hour * 60 + +parts.minute, day: +parts.day, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday) };
}
export function inQuietHours(settings, now = new Date()) {
  const q = settings.quietHours;
  if (!q.enabled) return false;
  const time = zonedParts(now, q.timeZone).time;
  return q.start < q.end ? time >= q.start && time < q.end : time >= q.start || time < q.end;
}
export function inDeliveryWindow(window, now = new Date()) {
  if (!window || !window.enabled) return true;
  const p = zonedParts(now, window.timeZone);
  // A Monday 22:00–02:00 window includes Tuesday 01:00, not Monday 01:00.
  const overnight = window.start > window.end;
  const startDay = overnight && p.time < window.end ? (p.weekday + 6) % 7 : p.weekday;
  const inside = overnight ? p.time >= window.start || p.time < window.end : p.time >= window.start && p.time < window.end;
  return inside && window.days.includes(startDay);
}
export function scheduleDue(schedule, now = new Date()) {
  if (!schedule?.enabled) return false;
  const p = zonedParts(now, schedule.timeZone);
  const [hour, minute] = schedule.time.split(':').map(Number);
  const gap = p.minutes - (hour * 60 + minute);
  return schedule.days.includes(p.weekday) && (!schedule.dayOfMonth || schedule.dayOfMonth === p.day) && gap >= 0 && gap < 5;
}
export function notificationCategory(category = 'system', key = '') {
  const value = `${category}:${key}`.toLowerCase();
  if (/system_p0|opend|unresolved|data_error|connection_error|行情异常/.test(value)) return 'data';
  if (/risk|guard|correlation|earnings|position.floor|panic|discipline|fuse/.test(value)) return 'risk';
  if (/valuation|forward.pe/.test(value)) return 'valuation';
  if (/buy|sell|exit:|entry:|stock-depth|milestone|target|channel/.test(value)) return 'trade';
  return EVENT_TYPES.some(t => t.id === category) ? category : 'system';
}
export function notificationPermission(settings, event, now = new Date()) {
  if (!settings.enabled) return 'disabled';
  if (inQuietHours(settings, now)) return 'quiet_hours';
  if (event.legacySchedule) return 'legacy_schedule_replaced';
  if (event.createdAt) {
    const created = Date.parse(event.createdAt);
    if (!Number.isFinite(created) || created > +now + 30_000 || +now - created > 120_000) return 'expired';
    if (settings.deliveryEpoch && created < Date.parse(settings.deliveryEpoch)) return 'before_settings_change';
  }
  if (event.scheduleId) {
    if (!scheduleDue(settings.schedules.find(s => s.id === event.scheduleId), now)) return 'schedule_disabled_or_outside_window';
  }
  if (event.category === 'breakout') {
    if (!settings.breakout?.enabled) return 'breakout_disabled';
    if (!['up', 'down'].includes(event.direction) || !settings.breakout[event.direction]) return 'breakout_direction_disabled';
    if (!Number.isFinite(Date.parse(event.occurredAt))) return 'breakout_unconfirmed';
    if (settings.deliveryEpoch && Date.parse(event.occurredAt) < Date.parse(settings.deliveryEpoch)) return 'before_settings_change';
    if (!inDeliveryWindow(settings.eventWindows?.breakout, now) || !inDeliveryWindow(settings.eventWindows?.[`breakout_${event.direction}`], now)) return 'outside_allowed_window';
    return null;
  }
  if (event.category === 'zExtreme') {
    const rule = settings.zExtreme;
    if (!rule?.enabled) return 'extreme_disabled';
    if (!['positive', 'negative'].includes(event.direction) || !rule[event.direction]) return 'extreme_direction_disabled';
    if (event.confirmed !== true || !Number.isFinite(Date.parse(event.occurredAt))) return 'extreme_unconfirmed';
    if (event.threshold !== rule[`${event.direction}Threshold`]) return 'extreme_rule_changed';
    if (settings.deliveryEpoch && Date.parse(event.occurredAt) < Date.parse(settings.deliveryEpoch)) return 'before_settings_change';
    if (!inDeliveryWindow(settings.eventWindows?.zExtreme, now) || !inDeliveryWindow(settings.eventWindows?.[`zExtreme_${event.direction}`], now)) return 'outside_allowed_window';
    return null;
  }
  const category = notificationCategory(event.category, event.key || event.dedupeKey);
  // Explicit report switches control report content; event switches also apply to
  // trade/risk/data/valuation messages produced by a scheduled review.
  if ((!event.scheduleId || category !== 'system') && !settings.events[category]) return 'category_disabled';
  if (!inDeliveryWindow(settings.eventWindows?.[category], now)) return 'outside_allowed_window';
  return null;
}
async function atomicJson(path, value) {
  const temp = `${path}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, path);
}
async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export function createNotificationControl({ root, token, sendJson, send, now = () => new Date() }) {
  const settingsFile = join(root, 'notification-settings.json');
  const ledgerFile = join(root, 'notification-deliveries.json');
  let queue = Promise.resolve();
  let workerSeenAt = null;
  const serial = task => { const result = queue.then(task, task); queue = result.catch(() => {}); return result; };
  async function settings() {
    const value = await readJson(settingsFile, defaultNotificationSettings());
    // Corrupt state fails closed. Never silently restore enabled defaults.
    if (value.version !== 1 || !Number.isInteger(value.revision)) throw new Error('通知设置不可用');
    const validated = validateNotificationSettings(value, value, now());
    // realtime 是第三阶段新增的，老设置文件里没有就按「全部关闭」的默认值读出来
    return { ...value, breakout: validated.breakout, zExtreme: validated.zExtreme, eventWindows: validated.eventWindows, realtime: validated.realtime };
  }
  async function status() {
    const value = await settings();
    return { settings: value, state: !value.enabled ? 'off' : inQuietHours(value, now()) ? 'quiet' : 'on',
      serverTime: now().toISOString(), workerSeenAt, eventTypes: EVENT_TYPES };
  }
  async function dispatch(event) {
    return serial(async () => {
      const value = await settings();
      const reason = notificationPermission(value, event, now());
      if (event.dryRun === true) return { status: reason ? 'suppressed' : 'would_send', reason, dryRun: true };
      const hash = createHash('sha256').update(String(event.dedupeKey || event.key || '')).digest('hex');
      await mkdir(root, { recursive: true });
      const ledger = await readJson(ledgerFile, []);
      if (ledger.some(row => row.id === hash)) return { status: 'deduplicated' };
      // Record the attempt first: crash/restart/reenable must not re-send it.
      ledger.push({ id: hash, at: now().toISOString(), status: reason || 'attempted' });
      await atomicJson(ledgerFile, ledger.slice(-10000));
      if (reason) return { status: 'suppressed', reason };
      const delivered = await send(event);
      ledger[ledger.length - 1].status = delivered ? 'sent' : 'failed';
      await atomicJson(ledgerFile, ledger.slice(-10000));
      return { status: delivered ? 'sent' : 'failed' };
    });
  }
  const isInternal = req => {
    const got = Buffer.from(String(req.headers.authorization || ''));
    const expected = Buffer.from(`Bearer ${token}`);
    return Boolean(token) && got.length === expected.length && timingSafeEqual(got, expected);
  };
  async function body(req) {
    let text = '';
    for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 48 * 1024) throw new Error('请求过大'); }
    return JSON.parse(text);
  }
  async function route(url, req, res) {
    if (!url.pathname.startsWith('/api/notifications/')) return false;
    try {
      if (url.pathname === '/api/notifications/settings' && req.method === 'GET') {
        sendJson(res, 200, await status()); return true;
      }
      if (url.pathname === '/api/notifications/settings' && req.method === 'PUT') {
        // No password by owner request. Same-origin/custom-header checks stop
        // cross-site drive-by forms, but are not visitor authentication.
        const origin = req.headers.origin;
        const allowed = !origin || new URL(origin).host === req.headers.host
          || ['https://myopenid.top', 'https://www.myopenid.top'].includes(origin);
        if (!allowed || req.headers['x-notification-settings'] !== '1' || !String(req.headers['content-type']).startsWith('application/json')) {
          sendJson(res, 403, { error: '请从本网站的通知抽屉修改设置' }); return true;
        }
        const input = await body(req);
        await serial(async () => {
          const previous = await settings();
          if (input.revision !== previous.revision) { sendJson(res, 409, { error: '其他设备已修改设置，请刷新后重试', ...(await status()) }); return; }
          const next = validateNotificationSettings(input, previous, now());
          await mkdir(root, { recursive: true }); await atomicJson(settingsFile, next);
          sendJson(res, 200, await status());
        });
        return true;
      }
      if (['/api/notifications/relay', '/api/notifications/worker'].includes(url.pathname) && req.method === 'POST') {
        if (!isInternal(req)) { sendJson(res, 401, { error: 'unauthorized' }); return true; }
        workerSeenAt = now().toISOString();
        if (url.pathname.endsWith('/worker')) { sendJson(res, 200, await status()); return true; }
        const event = await body(req);
        requireValue(typeof event.title === 'string' && event.title.length <= 200 && typeof event.body === 'string'
          && event.body.length <= 12000 && typeof event.dedupeKey === 'string' && event.dedupeKey.length <= 1000
          && typeof event.createdAt === 'string', '通知格式无效');
        if (event.presentation != null) {
          const p = event.presentation;
          requireValue(typeof p === 'object' && typeof p.group === 'string' && p.group.length <= 80
            && (p.sound === null || typeof p.sound === 'string' && p.sound.length <= 80)
            && ['active', 'passive', 'timeSensitive', 'critical'].includes(p.level), '通知样式无效');
        }
        sendJson(res, 200, await dispatch(event)); return true;
      }
      sendJson(res, 404, { error: 'not_found' });
    } catch (error) { sendJson(res, 400, { error: error instanceof Error ? error.message : '通知服务不可用' }); }
    return true;
  }
  return { settings, status, dispatch, route };
}
