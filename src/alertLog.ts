// 提醒日志：网站每发出一次提醒就记一行，服务器永久保存（服务器端在
// deploy/alert-log.mjs）。「隐藏已读」只藏在本机，不动服务器记录。
export type AlertCategory =
  | 'drawdown' | 'sentiment' | 'valuation' | 'zscore' | 'sell_line' | 'position' | 'system' | 'other';

export interface AlertLogEntry {
  id: string;
  occurred_at: string;
  category: AlertCategory;
  symbol: string | null;
  icon: string;
  text: string;
  value: number | null;
  threshold: number | null;
  pushed: boolean;
  /** 推送到底有没有发出去：sent / quiet_hours / 其他被拦下的原因。老记录没有这个字段。 */
  push_state?: string | null;
  /** 重要提醒连发的条数，只在连发时有值。 */
  push_repeat?: number | null;
  /** 写错的提醒只标作废、不删除。 */
  voided?: boolean;
  voided_reason?: string | null;
  voided_at?: string | null;
  /** 数字算错、但事情确实发生过的，改正数字并保留原文。 */
  corrected?: boolean;
  corrected_reason?: string | null;
  corrected_from?: string | null;
  backfilled: boolean;
  session: string | null;
  indicators: Record<string, number | null> | null;
  /** 合并进汇总行的明细；只有汇总行有。 */
  summary_items?: ReadonlyArray<{ symbol: string | null; text: string }> | null;
}

export const PUSH_BLOCK_LABELS: Readonly<Record<string, string>> = {
  realtime_disabled: '实时提醒未开',
  category_disabled: '类别开关未开',
  disabled: '推送总开关关闭',
  log_only: '只记录不推送',
};

/** 日志每行末尾的推送状态标签。老记录没有 push_state，就按原来的 pushed 显示。 */
export function pushStateLabel(entry: Pick<AlertLogEntry, 'pushed' | 'push_state' | 'push_repeat'>): string {
  const state = entry.push_state ?? (entry.pushed ? 'sent' : null);
  if (state === 'sent') {
    return entry.push_repeat && entry.push_repeat > 1 ? `[已推送 ×${entry.push_repeat}]` : '[已推送]';
  }
  if (state === 'quiet_hours') return '[免打扰]';
  if (state === 'dry_run') return '[测试推送]';
  if (state === 'failed') return '[推送失败]';
  if (state === 'pending_retry') return '[重试中]';
  const reason = state ? PUSH_BLOCK_LABELS[state] : null;
  return reason ? `[未推送 · ${reason}]` : '[未推送]';
}

export interface AlertLogPayload {
  version: number;
  updated_at: string | null;
  alerts: AlertLogEntry[];
}

export const ALERT_CATEGORY_LABELS: Readonly<Record<AlertCategory | 'all', string>> = {
  all: '全部',
  drawdown: '回撤',
  sentiment: '情绪(CNN·VIX)',
  valuation: '估值',
  zscore: 'Z-Score',
  sell_line: '卖出线',
  position: '仓位',
  system: '系统',
  other: '其他',
};

export const ALERT_FILTER_ORDER: ReadonlyArray<AlertCategory | 'all'> = [
  'all', 'drawdown', 'sentiment', 'valuation', 'zscore', 'sell_line', 'position', 'system',
];

const HIDDEN_STORAGE_KEY = 'portfolio-tracker:alert-log:hidden';
const READ_STORAGE_KEY = 'portfolio-tracker:alert-log:read';
const OPENED_STORAGE_KEY = 'portfolio-tracker:alert-log:opened';

export async function fetchAlertLog(endpoint: string, signal?: AbortSignal): Promise<AlertLogPayload> {
  const response = await fetch(endpoint, { cache: 'no-store', signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message;
    throw new Error(typeof message === 'string' ? message : `提醒日志读取失败（HTTP ${response.status}）`);
  }
  return body.log as AlertLogPayload;
}

export function loadHiddenAlertIds(): string[] {
  try {
    const raw = window.localStorage.getItem(HIDDEN_STORAGE_KEY);
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function saveHiddenAlertIds(ids: readonly string[]): void {
  try {
    window.localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify([...ids].slice(-5000)));
  } catch {
    // 本机存不下不影响页面，服务器记录本来就还在。
  }
}

/** 点过的重要提醒：只记在这台设备上，服务器记录一行都不动。 */
export function loadReadAlertIds(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(READ_STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function saveReadAlertIds(ids: readonly string[]): void {
  try {
    window.localStorage.setItem(READ_STORAGE_KEY, JSON.stringify([...ids].slice(-5000)));
  } catch {
    // 本机存不下不影响页面
  }
}

/** 这台设备上次打开日志页的时间，用来算未读数和「以下是新提醒」分隔线。 */
export function loadLastOpenedAt(): string | null {
  try {
    const value = window.localStorage.getItem(OPENED_STORAGE_KEY);
    return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}

export function saveLastOpenedAt(isoTime: string): void {
  try {
    window.localStorage.setItem(OPENED_STORAGE_KEY, isoTime);
  } catch {
    // 本机存不下不影响页面
  }
}

export function beijingText(isoTime: string): string {
  return zoned(isoTime, 'Asia/Shanghai');
}

export function easternText(isoTime: string): string {
  return zoned(isoTime, 'America/New_York');
}

function zoned(isoTime: string, timeZone: string): string {
  const date = new Date(isoTime);
  if (Number.isNaN(+date)) return isoTime;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('zh-CN', {
    timeZone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
