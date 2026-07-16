import type { QuantAnalysisSnapshot, QuantSignalStatWindow, QuantSymbolAnalysis } from './types';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

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
    throw new Error(`${symbol} 的六关数据格式无效`);
  }
  if (isRecord(value.signal_stats)) {
    for (const [signal, raw] of Object.entries(value.signal_stats)) {
      if (!isRecord(raw) || !isStatWindow(raw.d5) || !isStatWindow(raw.d20) || !isStatWindow(raw.d60)) {
        throw new Error(`${symbol}/${signal} 的历史统计格式无效`);
      }
    }
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

export type QuantSymbolLookup =
  | { found: true; symbol: string; analysis: QuantSymbolAnalysis }
  | { found: false; symbol: string; monitoredSymbols: string[] };

export function lookupQuantSymbol(snapshot: QuantAnalysisSnapshot, rawSymbol: string): QuantSymbolLookup {
  const symbol = rawSymbol.trim().toUpperCase();
  const analysis = snapshot.symbols[symbol];
  if (analysis) return { found: true, symbol, analysis };
  return { found: false, symbol, monitoredSymbols: Object.keys(snapshot.symbols).sort() };
}
