import type { QuantAnalysisSnapshot } from './types';

export function sourceDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const day = value.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
}

export function sourceTime(value: string | null | undefined): string {
  if (!sourceDate(value)) return '未提供';
  if (value && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '未提供';
    const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
    return `${parts} ET`;
  }
  return value!.length > 10 ? `${value!.slice(0, 10)} ${value!.slice(11, 16)}（来源时间）` : value!.slice(0, 10);
}

export function dateCoverage(values: Array<string | null | undefined>): string {
  const dates = values.map(sourceDate).filter((value): value is string => value !== null).sort();
  if (!dates.length) return '未提供数据日期';
  const range = dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} ～ ${dates.at(-1)}`;
  return `${range}${dates.length < values.length ? ' · 部分日期未提供' : ''}`;
}

export function snapshotDataDates(snapshot: QuantAnalysisSnapshot) {
  const peEntries = Object.values(snapshot.pe_history?.symbols ?? {}).filter((entry) => entry.current !== null);
  const historyEntries = Object.values(snapshot.symbols).map((entry) => entry.historical_standard).filter((entry) => entry != null);
  const dailyEntries = Object.values(snapshot.symbols).map((entry) => entry.ma_slope).filter((entry) => entry != null);
  return {
    // prices_at can be an evaluation timestamp, not an exchange trade timestamp.
    market: sourceTime(snapshot.freshness?.prices_at),
    marketDaily: dateCoverage(dailyEntries.map((entry) => entry.as_of)),
    pe: dateCoverage(peEntries.map((entry) => entry.series_end ?? entry.series.at(-1)?.date)),
    history: dateCoverage(historyEntries.map((entry) => entry.available_end)),
    historyGenerated: sourceTime(snapshot.freshness?.drawdown_generated_at),
  };
}
