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
  backfilled: boolean;
  session: string | null;
  indicators: Record<string, number | null> | null;
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
