import type { PeHistoryEntry, PeHistoryPayload } from './peData';
import type { QuantIndexEtfValuation, QuantMaSlopeDashboard } from './types';
import { smaOverheat, smaDownside } from './smaOverheat';

export const PE_INDEX_PROXIES: Readonly<Record<string, string>> = { QQQ: 'NDX', TQQQ: 'NDX', SPY: 'SPX', VOO: 'SPX' };
export const PE_HISTORY_PROXIES: Readonly<Record<string, string>> = { ...PE_INDEX_PROXIES, TSLL: 'TSLA', AVL: 'AVGO', NVDL: 'NVDA', METU: 'META' };
const ISSUER_PROXIES: Readonly<Record<string, string>> = { TECL: 'XLK', FAS: 'XLF', SOXL: 'SOXX' };
export const PE_NOT_APPLICABLE: Readonly<Record<string, string>> = { GLD: '实物黄金没有企业盈利，PE 不适用。', GLDM: '实物黄金没有企业盈利，PE 不适用。' };
export const INDEX_PE_SYMBOLS = new Set(['NDX', 'SOX', 'SPX', 'DIA', 'VOO', 'QQQ', 'TQQQ', 'SPY', 'XLK', 'XLF', 'TECL', 'FAS', 'SOXX', 'SOXL', 'IGV', 'SMH', 'MAGS', 'FNGS', 'FNGU', 'GDX', 'COPX', 'GLD', 'GLDM', 'TSLL', 'AVL', 'NVDL', 'METU', 'NAIL']);
export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const positive = (value: unknown): value is number => finite(value) && value > 0;

export function quantile(sorted: readonly number[], ratio: number): number | null {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
}

// Explicit underlying proxies only; never substitute an unrelated stock or index.
export function resolvePeEntry(symbol: string, history?: PeHistoryPayload): PeHistoryEntry | undefined {
  if (history?.metric !== 'ttm_pe') return undefined;
  if (history.symbols[symbol]) return history.symbols[symbol];
  const basis = PE_HISTORY_PROXIES[symbol];
  const entry = basis ? history.symbols[basis] : undefined;
  return entry ? { ...entry, basis_symbol: basis, basis_note: `${symbol} 使用 ${basis} ${PE_INDEX_PROXIES[symbol] ? '指数' : '基础股票'} TTM PE 作估值参考，非 ETF 自身 PE；价格、均线与斜率仍使用 ${symbol} 自身数据。` } : undefined;
}

export function resolveIssuerPeEntry(symbol: string, issuer?: QuantIndexEtfValuation) {
  if (issuer?.symbols[symbol]) return issuer.symbols[symbol];
  const basis = ISSUER_PROXIES[symbol];
  const entry = basis ? issuer?.symbols[basis] : undefined;
  return entry ? { ...entry, symbol, basis_symbol: basis, history_note: `${symbol} 引用 ${basis} 的发行商估值作参考，非杠杆 ETF 自身 PE。${entry.history_note}` } : undefined;
}

export function pePosition(symbol: string, history?: PeHistoryPayload, issuer?: QuantIndexEtfValuation) {
  const entry = resolvePeEntry(symbol, history);
  const official = positive(entry?.current) && entry?.series.length ? undefined : resolveIssuerPeEntry(symbol, issuer);
  const values = entry?.series.map(point => point.value).filter(positive).sort((a, b) => a - b) ?? [];
  const current = official ? (official.available && positive(official.current_pe) ? official.current_pe : null) : (positive(entry?.current) ? entry.current : null);
  const percentile = !official && current != null && values.length > 0 && finite(entry?.percentile) && entry.percentile >= 0 && entry.percentile <= 100 ? entry.percentile : null;
  const median = official ? null : quantile(values, .5);
  return {
    current, percentile, median, q30: official ? null : quantile(values, .3), q70: official ? null : quantile(values, .7),
    relativeToMedian: current != null && positive(median) ? (current / median - 1) * 100 : null,
    label: PE_NOT_APPLICABLE[symbol] ? 'PE 不适用' : percentile == null ? (current == null ? '暂无可靠 PE' : '历史位置未知') : percentile <= 20 ? '历史低位' : percentile <= 40 ? '历史偏低' : percentile < 70 ? '历史中区' : percentile < 90 ? '历史偏高' : '历史高位',
    tone: percentile == null ? 'unknown' : percentile <= 40 ? 'low' : percentile < 70 ? 'middle' : 'high',
    asOf: official?.as_of ?? entry?.series_end ?? entry?.series.at(-1)?.date ?? null,
    basis: official?.basis_symbol ?? entry?.basis_symbol ?? symbol,
    note: PE_NOT_APPLICABLE[symbol] ?? official?.history_note ?? entry?.basis_note ?? '',
    metricLabel: official?.metric_label ?? (official ? '官方指数 PE' : 'TTM PE'),
    sourceUrl: official?.source_url,
    official: Boolean(official), stale: official?.stale === true,
  };
}

export type SmaRisk = 'unavailable' | 'down_cross' | 'touch' | 'below' | 'near' | 'up';
export function smaIndicators(dashboard?: QuantMaSlopeDashboard | null) {
  // The master table is fixed at 8 sessions; never reinterpret the annualized 20-day slope.
  const points = dashboard?.slope_window_sessions === 8 && dashboard.slope_unit === 'pct_per_day'
    ? dashboard.series.filter(point => !point.is_partial).toSorted((a, b) => a.date.localeCompare(b.date)) : [];
  const latest = points.at(-1);
  const previous = points.at(-2);
  const slope20 = finite(latest?.slope20) ? latest.slope20 : null;
  const slope50 = finite(latest?.slope50) ? latest.slope50 : null;
  const slope200 = finite(latest?.slope200) ? latest.slope200 : null;
  const prior200 = finite(previous?.slope200) ? previous.slope200 : null;
  const samples = points.map(point => point.slope20).filter(finite);
  // Mid-rank prevents a flat, all-equal sample from incorrectly appearing '100% hot'.
  const percentile20 = slope20 != null && samples.length >= 252
    ? (samples.filter(value => value < slope20).length + samples.filter(value => value === slope20).length / 2) / samples.length * 100 : null;
  const overheat = smaOverheat(dashboard);
  const downside = smaDownside(dashboard);
  const hot = slope20 != null && slope20 > 0 && overheat.reliable && overheat.medianPeak != null && slope20 >= overheat.medianPeak;
  const cold = slope20 != null && slope20 < 0 && downside.reliable && downside.medianTrough != null && slope20 <= downside.medianTrough;
  const risk: SmaRisk = slope200 == null ? 'unavailable' : slope200 === 0 ? 'touch'
    : slope200 < 0 ? (prior200 != null && prior200 >= 0 ? 'down_cross' : 'below')
    : slope200 <= .01 ? 'near' : 'up';
  return {
    slope20, slope50, slope200, prior200, risk, hot, cold, percentile20, overheat, downside,
    asOf: latest?.date ?? null, sampleCount: samples.length, historyStart: points[0]?.date ?? null,
    heatLabel: slope20 == null ? '短线待更新' : hot ? '达到回落峰值参考' : cold ? '下降偏快 · 达到谷底参考' : slope20 > 0 ? '短线上行' : slope20 < 0 ? '短线下降' : '短线走平',
    riskLabel: ({ unavailable: '200DMA 待更新', down_cross: '200DMA 下穿零轴', touch: '200DMA 触及零轴', below: '200DMA 零轴下方', near: '200DMA 接近零轴', up: '200DMA 零轴上方' } as const)[risk],
    severe: risk === 'down_cross' || risk === 'touch' || risk === 'below',
  };
}

export type SmaIndicators = ReturnType<typeof smaIndicators>;
export type PePosition = ReturnType<typeof pePosition>;

export function slopePerDay(value: number | null) {
  if (value == null) return '—';
  // Preserve the sign around zero; rounding +0.0004 to 0.000 must not look like a zero touch.
  if (value !== 0 && Math.abs(value) < .001) return `${value > 0 ? '+' : ''}${Math.abs(value) < .000001 ? value.toPrecision(2) : value.toFixed(6).replace(/0+$/, '')}`;
  return `${value > 0 ? '+' : ''}${value.toFixed(3)}`;
}
