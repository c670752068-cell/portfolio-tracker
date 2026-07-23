export const PE_CACHE_KEY = 'portfolio-tracker:pe-cache-v1';

export type PeMetric = 'forward_pe' | 'ttm_pe';

export interface PePoint {
  date: string;
  value: number;
}

export interface PeHistoryEntry {
  current: number | null;
  percentile: number | null;
  series_start: string;
  series_end?: string;
  series: PePoint[];
  source: string;
  frequency: string;
  updated_at?: string | null;
}

export interface PeHistoryPayload {
  generated_at: string;
  metric: PeMetric;
  frequency: string;
  percentile_definition: string;
  lookback_years: number;
  symbols: Record<string, PeHistoryEntry>;
  missing_symbols?: string[];
  basis_note?: string;
}

export interface PeSnapshot {
  symbol: string;
  forwardPe: number | null;
  trailingPe: number | null;
  source: 'quant' | 'alphavantage';
  fetchedAt: string;
}

interface PeFetchOptions {
  now?: Date;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

interface PeCache {
  entries: Record<string, { date: string; snapshot: PeSnapshot }>;
}

export class PeRateLimitError extends Error {
  readonly code = 'alpha_vantage_daily_limit';

  constructor() {
    super('今日免费额度已用完，明日恢复');
    this.name = 'PeRateLimitError';
  }
}

export async function fetchQuantPeHistory(url: string): Promise<PeHistoryPayload> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `PE 历史读取失败（HTTP ${response.status}）`);
  }
  const raw: unknown = await response.json();
  const payload = isRecord(raw) && isRecord(raw.pe_history) ? raw.pe_history : raw;
  return parsePeHistoryPayload(payload);
}

export async function fetchForwardPe(
  rawSymbol: string,
  apiKey: string,
  options: PeFetchOptions = {},
): Promise<PeSnapshot> {
  const symbol = normalizeSymbol(rawSymbol);
  const key = apiKey.trim();
  if (!symbol) throw new Error('PE 标的代码为空');
  if (!key) throw new Error('未配置 Alpha Vantage PE API Key');

  const now = options.now ?? new Date();
  const storage = options.storage ?? localStorage;
  const date = now.toISOString().slice(0, 10);
  const cache = readCache(storage);
  const cached = cache.entries[symbol];
  if (cached?.date === date) return cached.snapshot;

  const endpoint = new URL('https://www.alphavantage.co/query');
  endpoint.searchParams.set('function', 'OVERVIEW');
  endpoint.searchParams.set('symbol', symbol);
  endpoint.searchParams.set('apikey', key);
  const response = await fetch(endpoint.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Alpha Vantage PE 读取失败（HTTP ${response.status}）`);
  const raw: unknown = await response.json();
  if (!isRecord(raw)) throw new Error('Alpha Vantage PE 响应格式无效');
  if (typeof raw.Note === 'string' || typeof raw.Information === 'string') {
    throw new PeRateLimitError();
  }

  const result: PeSnapshot = {
    symbol,
    forwardPe: nullablePositiveNumber(raw.ForwardPE),
    trailingPe: nullablePositiveNumber(raw.TrailingPE),
    source: 'alphavantage',
    fetchedAt: now.toISOString(),
  };
  cache.entries[symbol] = { date, snapshot: result };
  try {
    storage.setItem(PE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // A browser storage failure must not hide an otherwise valid response.
  }
  return result;
}

export async function resolvePeSnapshot(
  rawSymbol: string,
  history: PeHistoryPayload | null,
  alphaVantageApiKey: string,
  options: PeFetchOptions = {},
): Promise<PeSnapshot | null> {
  const symbol = normalizeSymbol(rawSymbol);
  const entry = history?.symbols[symbol];
  if (history && entry) {
    const current = nullablePositiveNumber(entry.current);
    return {
      symbol,
      forwardPe: history.metric === 'forward_pe' ? current : null,
      trailingPe: history.metric === 'ttm_pe' ? current : null,
      source: 'quant',
      fetchedAt: history.generated_at,
    };
  }
  if (!alphaVantageApiKey.trim()) return null;
  return fetchForwardPe(symbol, alphaVantageApiKey, options);
}

export function parsePeHistoryPayload(value: unknown): PeHistoryPayload {
  if (
    !isRecord(value)
    || typeof value.generated_at !== 'string'
    || (value.metric !== 'forward_pe' && value.metric !== 'ttm_pe')
    || typeof value.frequency !== 'string'
    || typeof value.percentile_definition !== 'string'
    || typeof value.lookback_years !== 'number'
    || !isRecord(value.symbols)
  ) {
    throw new Error('量化 PE 历史格式无效');
  }
  const symbols: Record<string, PeHistoryEntry> = {};
  for (const [rawSymbol, rawEntry] of Object.entries(value.symbols)) {
    if (!isRecord(rawEntry) || !Array.isArray(rawEntry.series)) continue;
    const series = rawEntry.series
      .filter(isRecord)
      .map((point) => ({
        date: typeof point.date === 'string' ? point.date : '',
        value: nullablePositiveNumber(point.value),
      }))
      .filter((point): point is PePoint => Boolean(point.date && point.value !== null));
    symbols[normalizeSymbol(rawSymbol)] = {
      current: nullablePositiveNumber(rawEntry.current),
      percentile: nullableFiniteNumber(rawEntry.percentile),
      series_start: typeof rawEntry.series_start === 'string' ? rawEntry.series_start : '',
      series_end: typeof rawEntry.series_end === 'string' ? rawEntry.series_end : undefined,
      series,
      source: typeof rawEntry.source === 'string' ? rawEntry.source : '量化系统',
      frequency: typeof rawEntry.frequency === 'string' ? rawEntry.frequency : value.frequency,
      updated_at: typeof rawEntry.updated_at === 'string' ? rawEntry.updated_at : null,
    };
  }
  return {
    generated_at: value.generated_at,
    metric: value.metric,
    frequency: value.frequency,
    percentile_definition: value.percentile_definition,
    lookback_years: value.lookback_years,
    symbols,
    missing_symbols: Array.isArray(value.missing_symbols)
      ? value.missing_symbols.map(normalizeSymbol).filter(Boolean)
      : [],
    basis_note: typeof value.basis_note === 'string' ? value.basis_note : undefined,
  };
}

function readCache(storage: Pick<Storage, 'getItem'>): PeCache {
  try {
    const raw = storage.getItem(PE_CACHE_KEY);
    if (!raw) return { entries: {} };
    const value: unknown = JSON.parse(raw);
    return isRecord(value) && isRecord(value.entries)
      ? value as unknown as PeCache
      : { entries: {} };
  } catch {
    return { entries: {} };
  }
}

function nullablePositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && ['', 'None', '-'].includes(value.trim())) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nullableFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeSymbol(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
