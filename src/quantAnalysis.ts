import type {
  QuantAnalysisSnapshot,
  QuantFinalVerdict,
  QuantFinalVerdictEnvelope,
  QuantFinalVerdictLayer,
  QuantSignalStatWindow,
  QuantSymbolAnalysis,
} from './types';
import { isRegularSession } from './marketSession';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const NEW_YORK_TIME_ZONE = 'America/New_York';

export const QUANT_ANALYSIS_REFRESH_MS = 25 * 60 * 1000;
export const QUANT_ANALYSIS_MARKET_REFRESH_MS = 5 * 60 * 1000;
export const QUANT_ANALYSIS_RESUME_REFRESH_MS = 5 * 60 * 1000;

export function quantAnalysisRefreshMs(date: Date): number {
  return isRegularSession(date) ? QUANT_ANALYSIS_MARKET_REFRESH_MS : QUANT_ANALYSIS_REFRESH_MS;
}

interface QuantRefreshVisibilityTarget {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: EventListener): void;
  removeEventListener(type: 'visibilitychange', listener: EventListener): void;
}

interface QuantRefreshTimerHost {
  setInterval(handler: () => void, timeout: number): ReturnType<typeof setInterval>;
  clearInterval(id: ReturnType<typeof setInterval>): void;
}

export function startQuantAnalysisAutoRefresh(
  refresh: () => void,
  visibilityTarget: QuantRefreshVisibilityTarget,
  timerHost: QuantRefreshTimerHost = globalThis,
  now: () => number = Date.now,
): () => void {
  let lastRefreshAt = now();
  const runRefresh = () => {
    lastRefreshAt = now();
    refresh();
  };
  const refreshIfVisible = () => {
    if (
      visibilityTarget.visibilityState === 'visible'
      && now() - lastRefreshAt >= quantAnalysisRefreshMs(new Date(now()))
    ) {
      runRefresh();
    }
  };
  const handleVisibilityChange = () => {
    if (
      visibilityTarget.visibilityState === 'visible'
      && now() - lastRefreshAt > QUANT_ANALYSIS_RESUME_REFRESH_MS
    ) {
      runRefresh();
    }
  };
  const timer = timerHost.setInterval(refreshIfVisible, QUANT_ANALYSIS_MARKET_REFRESH_MS);
  visibilityTarget.addEventListener('visibilitychange', handleVisibilityChange);
  return () => {
    timerHost.clearInterval(timer);
    visibilityTarget.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStatWindow(value: unknown): value is QuantSignalStatWindow {
  return isRecord(value)
    && typeof value.n === 'number'
    && (value.win_rate === null || typeof value.win_rate === 'number')
    && typeof value.sample_insufficient === 'boolean';
}

function validateSymbolAnalysis(value: unknown, symbol: string): asserts value is QuantSymbolAnalysis {
  if (!isRecord(value) || typeof value.available !== 'boolean') {
    throw new Error(`${symbol} 的量化分析格式无效`);
  }
  if (value.gates !== undefined && !isRecord(value.gates)) {
    throw new Error(`${symbol} 的价格与估值数据格式无效`);
  }
  if (isRecord(value.signal_stats)) {
    for (const [signal, raw] of Object.entries(value.signal_stats)) {
      if (!isRecord(raw) || !isStatWindow(raw.d5) || !isStatWindow(raw.d20) || !isStatWindow(raw.d60)) {
        throw new Error(`${symbol}/${signal} 的历史统计格式无效`);
      }
    }
  }
}

function validatePanicWindow(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)
    || typeof value.applicable !== 'boolean'
    || typeof value.state !== 'string'
    || typeof value.current_family_pct !== 'number'
    || typeof value.generated_at !== 'string'
    || !isRecord(value.symbols)) {
    throw new Error('恐慌抢买窗口格式无效');
  }
  for (const status of Object.values(value.symbols)) {
    if (!isRecord(status)
      || typeof status.applicable !== 'boolean'
      || typeof status.state !== 'string'
      || !isRecord(status.depth)
      || (typeof status.depth.open !== 'boolean' && status.depth.open !== null)
      || !isRecord(status.panic)
      || typeof status.panic.open !== 'boolean'
      || !isRecord(status.target)
      || typeof status.target.progress_pct !== 'number'
      || !isRecord(status.display)
      || typeof status.display.title !== 'string'
      || typeof status.display.depth_open_text !== 'string'
      || typeof status.display.panic_open_text !== 'string'
      || typeof status.display.progress_text !== 'string') {
      throw new Error('恐慌抢买窗口格式无效');
    }
    if (status.entry_gate !== undefined && !isEntryGate(status.entry_gate)) {
      throw new Error('恐慌抢买窗口格式无效');
    }
  }
}

function isEntryGate(value: unknown): boolean {
  if (!isRecord(value)
    || typeof value.available !== 'boolean'
    || (typeof value.passed !== 'boolean' && value.passed !== null)
    || typeof value.benchmark !== 'string'
    || typeof value.price_basis !== 'string'
    || !isRecord(value.drawdown)
    || !Array.isArray(value.moving_averages)
    || typeof value.reason !== 'string') return false;
  return value.moving_averages.every((item) => isRecord(item)
    && typeof item.period === 'number'
    && typeof item.value === 'number'
    && typeof item.touched === 'boolean'
    && typeof item.gap_pct === 'number');
}

function validateOpportunitySummary(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)
    || !Array.isArray(value.buy_ready)
    || !Array.isArray(value.buy_near)
    || !Array.isArray(value.sell_ready)
    || !Array.isArray(value.idle_symbols)
    || typeof value.idle_count !== 'number'
    || !isRecord(value.depth_states)
    || typeof value.generated_at !== 'string') {
    throw new Error('今日机会一览格式无效');
  }
  const rows = [...value.buy_ready, ...value.buy_near, ...value.sell_ready];
  if (rows.some((item) => !isRecord(item) || typeof item.symbol !== 'string')) {
    throw new Error('今日机会一览格式无效');
  }
}

function isFinalVerdictLayer(value: unknown): value is QuantFinalVerdictLayer {
  return isRecord(value)
    && typeof value.layer === 'string'
    && (value.label === undefined || typeof value.label === 'string')
    && (value.state === undefined || typeof value.state === 'string')
    && (value.passed === undefined || value.passed === null || typeof value.passed === 'boolean')
    && (value.applicable === undefined || typeof value.applicable === 'boolean')
    && (value.reason === undefined || typeof value.reason === 'string')
    && (value.benchmark === undefined || typeof value.benchmark === 'string')
    && (value.gap_pp === undefined || typeof value.gap_pp === 'number')
    && (value.trigger_price === undefined || typeof value.trigger_price === 'number');
}

function isFinalVerdict(value: unknown): value is QuantFinalVerdict {
  return isRecord(value)
    && typeof value.symbol === 'string'
    && typeof value.verdict === 'string'
    && (value.single_sentence === undefined || typeof value.single_sentence === 'string')
    && (value.is_silence_by_rule === undefined || typeof value.is_silence_by_rule === 'boolean')
    && (value.data_as_of === undefined || value.data_as_of === null || typeof value.data_as_of === 'string')
    && (value.data_stale_days === undefined || typeof value.data_stale_days === 'number')
    && (value.data_stale === undefined || typeof value.data_stale === 'boolean')
    && (value.blocking_layers === undefined || (Array.isArray(value.blocking_layers)
      && value.blocking_layers.every((item) => isRecord(item) && typeof item.layer === 'string' && typeof item.reason === 'string')))
    && (value.passing_layers === undefined || (Array.isArray(value.passing_layers)
      && value.passing_layers.every((item) => typeof item === 'string')))
    && (value.unknown_layers === undefined || (Array.isArray(value.unknown_layers)
      && value.unknown_layers.every((item) => typeof item === 'string')))
    && (value.layers === undefined || (Array.isArray(value.layers) && value.layers.every(isFinalVerdictLayer)));
}

function isFinalVerdictEnvelope(
  value: QuantAnalysisSnapshot['final_verdict'],
): value is QuantFinalVerdictEnvelope {
  return isRecord(value)
    && isRecord(value.symbols)
    && Object.values(value.symbols).every(isFinalVerdict);
}

/**
 * Supports the current `{ symbols: … }` contract and a short-lived direct-map
 * payload from older gateway snapshots.  Consumers always receive a map.
 */
export function finalVerdictSymbols(snapshot: QuantAnalysisSnapshot): Record<string, QuantFinalVerdict> {
  const payload = snapshot.final_verdict;
  if (!payload) return {};
  if (isFinalVerdictEnvelope(payload)) return payload.symbols;
  return payload;
}

/** Server-owned freshness accompanying a wrapped final-verdict payload. */
export function finalVerdictFreshness(snapshot: QuantAnalysisSnapshot): Pick<QuantFinalVerdictEnvelope, 'data_stale' | 'stale_days' | 'data_as_of'> | undefined {
  const payload = snapshot.final_verdict;
  if (!isFinalVerdictEnvelope(payload)) return undefined;
  return {
    data_stale: payload.data_stale,
    stale_days: payload.stale_days,
    data_as_of: payload.data_as_of,
  };
}

function validateFinalVerdicts(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new Error('最终裁决格式无效');
  const symbols = isRecord(value.symbols) ? value.symbols : value;
  if (!Object.values(symbols).every(isFinalVerdict)) {
    throw new Error('最终裁决格式无效');
  }
}

export function parseQuantAnalysis(value: unknown): QuantAnalysisSnapshot {
  if (!isRecord(value)
    || value.source !== 'futu-assistant'
    || typeof value.generated_at !== 'string'
    || typeof value.rule_version !== 'string'
    || typeof value.disclaimer !== 'string'
    || !isRecord(value.context)
    || !isRecord(value.symbols)) {
    throw new Error('量化分析快照格式无效');
  }
  for (const [symbol, analysis] of Object.entries(value.symbols)) {
    validateSymbolAnalysis(analysis, symbol);
  }
  validatePanicWindow(value.panic_window);
  validateOpportunitySummary(value.summary);
  validateFinalVerdicts(value.final_verdict);
  return value as unknown as QuantAnalysisSnapshot;
}

export async function fetchQuantAnalysis(url: string): Promise<QuantAnalysisSnapshot> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `量化分析读取失败（HTTP ${response.status}）`);
  }
  return parseQuantAnalysis(await response.json());
}

export function isQuantAnalysisStale(generatedAt: string, now = Date.now()): boolean {
  const timestamp = Date.parse(generatedAt);
  return !Number.isFinite(timestamp) || now - timestamp > STALE_AFTER_MS;
}

export function quantAnalysisAgeHours(generatedAt: string, now = Date.now()): number | null {
  const timestamp = Date.parse(generatedAt);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((now - timestamp) / HOUR_MS));
}

export function quantAnalysisFreshnessText(generatedAt: string, now = Date.now()): string {
  const timestamp = Date.parse(generatedAt);
  if (!Number.isFinite(timestamp)) return '快照时间无效';
  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NEW_YORK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const ageMinutes = Math.max(0, Math.floor((now - timestamp) / MINUTE_MS));
  return `快照 ${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute} ET，${ageMinutes} 分钟前`;
}

export type QuantSymbolLookup =
  | { found: true; symbol: string; analysis: QuantSymbolAnalysis }
  | { found: false; symbol: string; monitoredSymbols: string[] };

export function lookupQuantSymbol(snapshot: QuantAnalysisSnapshot, rawSymbol: string): QuantSymbolLookup {
  const symbol = rawSymbol.trim().toUpperCase();
  const analysis = snapshot.symbols[symbol];
  if (analysis) return { found: true, symbol, analysis };
  return { found: false, symbol, monitoredSymbols: Object.keys(snapshot.symbols).sort() };
}
