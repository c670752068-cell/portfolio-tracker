// 三大指数卡片：服务器已经算好并缓存，网页只读。
// 数据源和实际延迟都由服务器照实给出，这里只做解析和显示格式化。
export const INDEX_STALE_MS = 120_000;
const DEFAULT_REFRESH_MS = 30_000;

export interface IndexItem {
  key: string;
  name: string;
  symbol: string;
  futures: boolean;
  price: number | null;
  changePercent: number | null;
  quoteTime: string | null;
  delayMinutes: number | null;
}
export interface IndexQuotes {
  session: string | null;
  time: string | null;
  refreshMs: number;
  source: string;
  items: IndexItem[];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseIndexQuotes(body: unknown): IndexQuotes {
  const store = record(record(body).indexes);
  const rows = Array.isArray(store.items) ? store.items : [];
  return {
    session: typeof store.session === 'string' ? store.session : null,
    time: typeof store.time === 'string' ? store.time : null,
    refreshMs: finite(store.refresh_ms) ?? DEFAULT_REFRESH_MS,
    source: typeof store.source === 'string' ? store.source : '',
    items: rows.map((raw) => {
      const item = record(raw);
      return {
        key: String(item.key || ''),
        name: String(item.name || ''),
        symbol: String(item.symbol || ''),
        futures: item.futures === true,
        price: finite(item.price),
        changePercent: finite(item.change_percent),
        quoteTime: typeof item.quote_time === 'string' ? item.quote_time : null,
        delayMinutes: finite(item.delay_minutes),
      };
    }),
  };
}

export async function fetchIndexQuotes(endpoint: string, signal?: AbortSignal): Promise<IndexQuotes> {
  const response = await fetch(endpoint, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`三大指数读取失败（HTTP ${response.status}）`);
  return parseIndexQuotes(await response.json());
}

export function changeText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '暂无';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/** 数据源本身的延迟（例如免费期货行情 10 分钟），没有就不写。 */
export function delayText(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return '';
  return `延迟 ${Math.round(minutes)} 分钟`;
}

/** 超过 2 分钟没拿到新数据就标「数据延迟」，不能一直显示旧数字还不提示。 */
export function indexDataState(fetchedAt: number | null, now: number): 'live' | 'stale' {
  if (fetchedAt === null) return 'stale';
  return now - fetchedAt > INDEX_STALE_MS ? 'stale' : 'live';
}
