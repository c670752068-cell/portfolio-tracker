// 日志页每一行怎么显示：手机上默认只占一行，点开才看全文。
// 这里全是纯函数，和 React 无关，方便单测。
import { pushStateLabel, type AlertLogEntry } from './alertLog';

/** 一行能放下的字数（手机 390px、11px 等宽字体实测）。 */
export const HEADLINE_MAX = 26;

const SESSION_TAG = /^\s*\[[^\]]*\]\s*/u;
const PUSH_ICONS: Readonly<Record<string, string>> = {
  sent: '📲', quiet_hours: '🌙', failed: '❌', pending_retry: '⏳', dry_run: '🧪',
};

const HAS_DIGIT = /\d/u;

/** 括号里的说明：括号前有数字就只留括号前，否则取括号里第一段带数字的内容。 */
function withoutParentheses(part: string): string {
  const open = part.indexOf('（');
  if (open < 0) return part;
  const head = part.slice(0, open).trim();
  if (HAS_DIGIT.test(head)) return head;
  const close = part.indexOf('）', open);
  const inside = part.slice(open + 1, close < 0 ? undefined : close);
  const chunk = inside.split('，').map((item) => item.trim()).find((item) => HAS_DIGIT.test(item));
  return chunk || head;
}

/** 时间轴上那一行的正文：标的 + 关键数字，长段落压短。 */
export function alertHeadline(entry: Pick<AlertLogEntry, 'text' | 'symbol'>): string {
  const firstLine = String(entry.text || '').split('\n')[0].replace(SESSION_TAG, '');
  const parts = firstLine
    .split('·')
    .map((part) => withoutParentheses(part
      .trim()
      // 「Z 0.38 → 0.52」只留现在的值
      .replace(/^([^\d+（(-]*)[^→（(]*→\s*/u, '$1')
      // 「涨得更多，偏强」只留结论；别的逗号不动，免得把「最深 -11.3%」切掉
      .replace(/^(?:涨得更多|跌得更深)，/u, '')
      // 分号后面是操作说明，展开才看
      .replace(/；.*$/u, '')
      .replace(/。$/u, '')
      .trim()))
    .map((part) => part.trim())
    .filter(Boolean);
  const symbol = String(entry.symbol || '');
  // 原文里没写标的代码时补在最前面，不然一行看不出是谁
  if (symbol && !parts.some((part) => part.includes(symbol))) parts.unshift(symbol);
  const compact = parts.join(' · ');
  if (compact.length <= HEADLINE_MAX) return compact;
  return `${compact.slice(0, HEADLINE_MAX).replace(/[\s·→（(、，,]+$/u, '')}…`;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 日期分隔行用的「10-20 周二」，按北京时间。 */
export function dayLabel(isoTime: string): string {
  const date = new Date(isoTime);
  if (Number.isNaN(+date)) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const weekday = new Date(`${new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)}T12:00:00Z`).getUTCDay();
  return `${parts.month}-${parts.day} ${WEEKDAYS[weekday]}`;
}

/** 同一天的提醒归到一组，用来画日期分隔行。 */
export function sameBeijingDay(left: string, right: string): boolean {
  return dayLabel(left) === dayLabel(right) && dayLabel(left) !== '';
}

/** 行尾的推送状态小图标，鼠标放上去（手机长按）看原因。 */
export function pushStateIcon(
  entry: Pick<AlertLogEntry, 'pushed' | 'push_state' | 'push_repeat'>,
): { icon: string; label: string } {
  const state = entry.push_state ?? (entry.pushed ? 'sent' : null);
  return {
    icon: (state && PUSH_ICONS[state]) || '🔕',
    label: pushStateLabel(entry).replace(/^\[|\]$/gu, ''),
  };
}

function important(entry: AlertLogEntry): boolean {
  return entry.voided !== true && entry.indicators?.level === 1;
}

/** 重要提醒左边那条颜色竖条：买入绿、卖出红、风险橙。 */
export function alertAccent(entry: AlertLogEntry): 'buy' | 'sell' | 'risk' | null {
  if (!important(entry)) return null;
  const text = String(entry.text || '');
  if (entry.category === 'sell_line' || /🔴|🟠|卖出|卖点/u.test(`${entry.icon}${text}`)) return 'sell';
  if (/🟢|买入区|低估值/u.test(`${entry.icon}${text}`)) return 'buy';
  return 'risk';
}

/** 「我据此下单了」按哪个方向生成草稿：红/橙提醒按卖出，其余按买入。 */
export function suggestedSide(entry: AlertLogEntry): 'BUY' | 'SELL' {
  const text = `${entry.icon}${entry.text}`;
  return entry.category === 'sell_line' || /🔴|🟠|卖出|卖点/u.test(text) ? 'SELL' : 'BUY';
}

/** 「仅记录」级别：默认折叠，打开「显示全部」才出现。 */
export function isLogOnly(entry: AlertLogEntry): boolean {
  return entry.indicators?.level === 3;
}

const SESSION_NAMES: Readonly<Record<string, string>> = {
  pre: '盘前', regular: '盘中', post: '盘后', overnight: '夜盘', closed: '休市',
};
const BROKER_PREFIX = /^([A-Z]{2,8})\s*·/u;

export interface TimelineItem {
  kind: 'single' | 'group';
  key: string;
  label: string;
  occurredAt: string;
  entries: AlertLogEntry[];
}

function minuteKey(isoTime: string): string {
  return String(isoTime).slice(0, 16);
}

function groupLabel(entries: readonly AlertLogEntry[]): string {
  const first = entries[0];
  const broker = BROKER_PREFIX.exec(String(first.text || ''))?.[1];
  if (first.category === 'position') return `${broker ? `${broker} ` : ''}成交 · ${entries.length} 笔`;
  const session = SESSION_NAMES[String(first.session || '')] || '';
  if (first.category === 'valuation') return `${session}估值 · ${entries.length} 个标的`;
  return `${session}${ALERT_GROUP_NAMES[first.category] || '提醒'} · ${entries.length} 条`;
}

const ALERT_GROUP_NAMES: Readonly<Record<string, string>> = {
  drawdown: '回撤', sentiment: '情绪', valuation: '估值', zscore: 'Z-Score',
  sell_line: '卖出线', position: '成交', system: '系统', other: '提醒',
};

/**
 * 同一分钟、同一类的多条并成一行，点开看明细。
 * 重要提醒（level 1）不参与合并，免得被折进去看不见。
 */
export function groupTimeline(rows: readonly AlertLogEntry[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const buckets = new Map<string, AlertLogEntry[]>();
  for (const entry of rows) {
    if (entry.indicators?.level === 1) {
      items.push({ kind: 'single', key: entry.id, label: '', occurredAt: entry.occurred_at, entries: [entry] });
      continue;
    }
    const broker = entry.category === 'position' ? BROKER_PREFIX.exec(String(entry.text || ''))?.[1] || '' : '';
    const key = `${entry.category}:${broker}:${minuteKey(entry.occurred_at)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(entry);
  }
  for (const [key, entries] of buckets) {
    if (entries.length === 1) {
      items.push({ kind: 'single', key: entries[0].id, label: '', occurredAt: entries[0].occurred_at, entries });
      continue;
    }
    const occurredAt = entries.reduce(
      (latest, item) => (item.occurred_at > latest ? item.occurred_at : latest),
      entries[0].occurred_at,
    );
    items.push({ kind: 'group', key, label: groupLabel(entries), occurredAt, entries });
  }
  return items.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

/** 置顶区的时间窗：只放最近 24 小时内的重要未读提醒。 */
export const PINNED_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface AlertPartition {
  pinned: AlertLogEntry[];
  timeline: AlertLogEntry[];
  unread: number;
  /** 时间轴最前面有几条是上次打开之后新增的，分隔线画在它们下面。 */
  newCount: number;
}

/**
 * 重要且没点过的置顶；点过之后回到时间顺序。
 * 未读数按这台设备上次打开日志页的时间算，没存过就不画分隔线。
 */
export function partitionAlerts(
  rows: readonly AlertLogEntry[],
  { readIds = [], lastOpenedAt = null, now = new Date() }: {
    readIds?: readonly string[];
    lastOpenedAt?: string | null;
    now?: Date;
  },
): AlertPartition {
  const read = new Set(readIds);
  const sorted = [...rows].sort((left, right) => right.occurred_at.localeCompare(left.occurred_at));
  // 置顶区只放最近 24 小时内的重要未读提醒，更早的回到时间线（颜色竖条保留）
  const freshFloor = new Date(+now - PINNED_WINDOW_MS).toISOString();
  const pinnedIds = new Set(sorted
    .filter((item) => important(item) && !read.has(item.id) && item.occurred_at >= freshFloor)
    .map((item) => item.id));
  const timeline = sorted.filter((item) => !pinnedIds.has(item.id));
  const isNew = (item: AlertLogEntry) => lastOpenedAt !== null && item.occurred_at > lastOpenedAt;
  return {
    pinned: sorted.filter((item) => pinnedIds.has(item.id)),
    timeline,
    unread: lastOpenedAt === null ? sorted.length : sorted.filter(isNew).length,
    newCount: timeline.filter(isNew).length,
  };
}
