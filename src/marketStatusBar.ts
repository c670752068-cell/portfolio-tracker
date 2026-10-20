// 日志页顶部那排小卡片的数字。纯函数，拿不到的数一律写「暂无」，不拿 0 顶替。
import type { AlertLogEntry } from './alertLog';

export const SESSION_LABELS: Readonly<Record<string, string>> = {
  pre: '盘前', regular: '盘中', post: '盘后', overnight: '夜盘', closed: '休市',
};

export interface StatusQuote { price: number | null; previousClose: number | null }
export interface CnnReading { score: number | null; previous: number | null; at: string | null }
export interface StatusCard {
  key: 'qqq' | 'vix' | 'cnn' | 'important' | 'session';
  label: string;
  value: string;
  detail: string;
  tone: 'warn' | 'calm' | 'muted';
}

function finite(value: unknown): number | null {
  // Number(null) 是 0：不挡掉就会把「没有数」算成 0，写出「离前高 -100%」
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/** 离前高：用完整收盘序列里的最高点当前高，没有序列就算不出。 */
export function qqqDrawdownPct(
  price: number | null, series: readonly { close: number; date?: string }[],
): number | null {
  const current = finite(price);
  const peak = series.reduce<number | null>(
    (best, point) => (finite(point.close) !== null && (best === null || point.close > best) ? point.close : best),
    null,
  );
  if (current === null || peak === null || peak <= 0) return null;
  return (current / peak - 1) * 100;
}

export function vixChangePct(quote: StatusQuote | null): number | null {
  const current = finite(quote?.price);
  const previous = finite(quote?.previousClose);
  if (current === null || previous === null || previous <= 0) return null;
  return (current / previous - 1) * 100;
}

/** 「上次」取提醒日志里最近一次和现在不同的 CNN 读数，没有就留空。 */
export function cnnFromAlerts(
  alerts: readonly AlertLogEntry[], score: number | null, at: string | null,
): CnnReading {
  const readings = alerts
    .filter((item) => String(item.symbol || '').toUpperCase() === 'CNN' && finite(item.value) !== null)
    .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at));
  const current = finite(score);
  const previous = readings.find((item) => finite(item.value) !== current)?.value ?? null;
  return { score: current, previous: finite(previous), at };
}

/** 今日重要提醒的条数，按北京时间当天算；作废的不计。 */
export function importantTodayCount(alerts: readonly AlertLogEntry[], now: Date): number {
  const today = beijingDate(now.toISOString());
  return alerts.filter((item) => item.voided !== true
    && item.indicators?.level === 1
    && beijingDate(item.occurred_at) === today).length;
}

function beijingDate(isoTime: string): string {
  const date = new Date(isoTime);
  if (Number.isNaN(+date)) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function signed(value: number | null, digits: number, suffix = ''): string {
  if (value === null) return '暂无';
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}${suffix}`;
}

function arrow(value: number | null): string {
  if (value === null || value === 0) return '';
  return value > 0 ? ' ↑' : ' ↓';
}

export interface StatusQuotes {
  qqq: StatusQuote | null;
  vix: StatusQuote | null;
  session: string | null;
  time: string | null;
}

/** 行情代理的返回；缺什么就是 null，不编数字。 */
export function parseStatusQuotes(body: unknown): StatusQuotes {
  const value = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const rows = Array.isArray(value.quotes) ? value.quotes : [];
  const pick = (names: readonly string[]): StatusQuote | null => {
    const row = rows.find((item) => {
      const symbol = String((item as { symbol?: unknown })?.symbol || '').toUpperCase();
      return names.includes(symbol);
    }) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { price: finite(row.price), previousClose: finite(row.previousClose) };
  };
  const session = typeof value.session === 'string' && SESSION_LABELS[value.session] ? value.session : null;
  const time = typeof value.time === 'string' && !Number.isNaN(Date.parse(value.time)) ? value.time : null;
  return { qqq: pick(['QQQ']), vix: pick(['^VIX', 'VIX']), session, time };
}

/** 量化快照里的 CNN 读数；字段缺失就当没有。 */
export function cnnScoreFrom(snapshot: { context?: Record<string, unknown> } | null): { score: number | null; at: string | null } {
  const context = (snapshot?.context ?? {}) as Record<string, unknown>;
  const fear = (typeof context.cnn_fear_greed === 'object' && context.cnn_fear_greed !== null
    ? context.cnn_fear_greed
    : {}) as Record<string, unknown>;
  const at = typeof fear.as_of === 'string' ? fear.as_of : null;
  return { score: fear.available === false ? null : finite(fear.score), at };
}

export function statusCards({
  qqq = null, qqqSeries = [], vix = null, cnn = { score: null, previous: null, at: null },
  importantToday = 0, session = null,
}: {
  qqq?: StatusQuote | null;
  qqqSeries?: readonly { close: number; date?: string }[];
  vix?: StatusQuote | null;
  cnn?: CnnReading;
  importantToday?: number;
  session?: string | null;
}): StatusCard[] {
  const drawdown = qqqDrawdownPct(qqq?.price ?? null, qqqSeries);
  const vixChange = vixChangePct(vix);
  const cnnDelta = cnn.score !== null && cnn.previous !== null ? cnn.score - cnn.previous : null;
  return [
    {
      key: 'qqq', label: 'QQQ',
      value: finite(qqq?.price) === null ? '暂无' : Number(qqq?.price).toFixed(2),
      detail: `离前高 ${drawdown === null ? '暂无' : `${signed(drawdown, 1)}%`}`,
      tone: drawdown !== null && drawdown <= -5 ? 'warn' : 'muted',
    },
    {
      key: 'vix', label: 'VIX',
      value: finite(vix?.price) === null ? '暂无' : Number(vix?.price).toFixed(2),
      detail: `较昨收 ${vixChange === null ? '暂无' : `${signed(vixChange, 1)}%${arrow(vixChange)}`}`,
      tone: vixChange === null ? 'muted' : vixChange > 0 ? 'warn' : 'calm',
    },
    {
      key: 'cnn', label: 'CNN',
      value: cnn.score === null ? '暂无' : cnn.score.toFixed(0),
      detail: `较上次 ${cnnDelta === null ? '暂无' : `${signed(cnnDelta, 0)}${arrow(cnnDelta)}`}`,
      tone: cnnDelta === null ? 'muted' : cnnDelta < 0 ? 'warn' : 'calm',
    },
    {
      key: 'important', label: '今日重要', value: String(importantToday), detail: '条',
      tone: importantToday > 0 ? 'warn' : 'muted',
    },
    {
      key: 'session', label: '当前时段',
      value: session ? SESSION_LABELS[session] || '暂无' : '暂无',
      detail: '美东交易时段',
      tone: 'muted',
    },
  ];
}
