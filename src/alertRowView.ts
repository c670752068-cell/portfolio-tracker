// 日志页每一行怎么显示：手机上默认只占一行，点开才看全文。
// 这里全是纯函数，和 React 无关，方便单测。
import { pushStateLabel, type AlertLogEntry } from './alertLog';

/** 一行能放下的字数（手机 390px、11px 等宽字体实测）。 */
export const HEADLINE_MAX = 26;

const SESSION_TAG = /^\s*\[[^\]]*\]\s*/u;
const PUSH_ICONS: Readonly<Record<string, string>> = {
  sent: '📲', quiet_hours: '🌙', failed: '❌', pending_retry: '⏳', dry_run: '🧪',
};

/** 时间轴上那一行的正文：标的 + 关键数字，长段落压短。 */
export function alertHeadline(entry: Pick<AlertLogEntry, 'text'>): string {
  const firstLine = String(entry.text || '').split('\n')[0].replace(SESSION_TAG, '');
  const compact = firstLine
    .split('·')
    .map((part) => part
      .trim()
      // 「Z 0.38 → 0.52」只留现在的值，「涨得更多，偏强」只留结论
      .replace(/^([^\d+（(-]*)[^→（(]*→\s*/u, '$1')
      .replace(/^.*，/u, '')
      // 分号后面是操作说明，展开才看
      .replace(/；.*$/u, '')
      .replace(/。$/u, '')
      .trim())
    .filter(Boolean)
    .join(' ');
  if (compact.length <= HEADLINE_MAX) return compact;
  return `${compact.slice(0, HEADLINE_MAX).replace(/[\s·→（(、，,]+$/u, '')}…`;
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

/** 「仅记录」级别：默认折叠，打开「显示全部」才出现。 */
export function isLogOnly(entry: AlertLogEntry): boolean {
  return entry.indicators?.level === 3;
}

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
  { readIds = [], lastOpenedAt = null }: { readIds?: readonly string[]; lastOpenedAt?: string | null },
): AlertPartition {
  const read = new Set(readIds);
  const sorted = [...rows].sort((left, right) => right.occurred_at.localeCompare(left.occurred_at));
  const pinnedIds = new Set(sorted.filter((item) => important(item) && !read.has(item.id)).map((item) => item.id));
  const timeline = sorted.filter((item) => !pinnedIds.has(item.id));
  const isNew = (item: AlertLogEntry) => lastOpenedAt !== null && item.occurred_at > lastOpenedAt;
  return {
    pinned: sorted.filter((item) => pinnedIds.has(item.id)),
    timeline,
    unread: lastOpenedAt === null ? sorted.length : sorted.filter(isNew).length,
    newCount: timeline.filter(isNew).length,
  };
}
