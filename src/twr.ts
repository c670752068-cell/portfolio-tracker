import type { DecisionCashFlow, DecisionNavPoint } from './decisionLog';

// 时间加权收益率：把出入金的影响剔掉，才能和「一直满仓 QQQ」这类基准比。
// 单期收益 r = (期末净值 − 本期出入金) / 期初净值 − 1，再逐期相乘。
export interface TwrResult {
  returnPct: number | null;
  maxDrawdownPct: number | null;
  monthly: { month: string; returnPct: number }[];
  start: string | null;
  end: string | null;
  periods: number;
}

export interface ClosePoint { date: string; close: number }

const EMPTY: TwrResult = { returnPct: null, maxDrawdownPct: null, monthly: [], start: null, end: null, periods: 0 };

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function buildTwr(
  navSeries: readonly DecisionNavPoint[],
  cashFlows: readonly DecisionCashFlow[],
  { from = null }: { from?: string | null } = {},
): TwrResult {
  const points = [...navSeries]
    .filter((point) => typeof point.date === 'string' && (!from || point.date >= from))
    .sort((left, right) => left.date.localeCompare(right.date));
  if (points.length < 2) return EMPTY;

  let index = 1;
  let peak = 1;
  let maxDrawdown = 0;
  let periods = 0;
  const byMonth = new Map<string, number>();
  for (let position = 1; position < points.length; position += 1) {
    const previous = positive(points[position - 1].nav);
    const current = points[position].nav;
    if (previous === null || typeof current !== 'number' || !Number.isFinite(current)) return EMPTY;
    const flow = cashFlows
      .filter((item) => item.date > points[position - 1].date && item.date <= points[position].date)
      .reduce((sum, item) => sum + (Number.isFinite(item.amount) ? item.amount : 0), 0);
    const growth = (current - flow) / previous;
    if (!Number.isFinite(growth) || growth <= 0) return EMPTY;
    index *= growth;
    periods += 1;
    peak = Math.max(peak, index);
    maxDrawdown = Math.min(maxDrawdown, index / peak - 1);
    const month = points[position].date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 1) * growth);
  }

  return {
    returnPct: (index - 1) * 100,
    maxDrawdownPct: maxDrawdown * 100,
    monthly: [...byMonth.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([month, growth]) => ({ month, returnPct: (growth - 1) * 100 })),
    start: points[0].date,
    end: points[points.length - 1].date,
    periods,
  };
}

function closeAtOrBefore(series: readonly ClosePoint[], date: string): ClosePoint | null {
  let found: ClosePoint | null = null;
  for (const point of series) {
    if (point.date > date) break;
    if (positive(point.close) !== null) found = point;
  }
  return found;
}

function closeAtOrAfter(series: readonly ClosePoint[], date: string): ClosePoint | null {
  for (const point of series) {
    if (point.date >= date && positive(point.close) !== null) return point;
  }
  return null;
}

export function buyAndHoldReturn(
  series: readonly ClosePoint[], from: string, to: string,
): number | null {
  const sorted = [...series].sort((left, right) => left.date.localeCompare(right.date));
  const start = closeAtOrAfter(sorted, from);
  const end = closeAtOrBefore(sorted, to);
  if (!start || !end || end.date <= start.date) return null;
  return (end.close / start.close - 1) * 100;
}

// 每月再平衡的混合基准（默认 60% QQQ + 40% SGOV）。
export function blendedBenchmarkReturn(
  risky: readonly ClosePoint[],
  safe: readonly ClosePoint[],
  from: string,
  to: string,
  riskyWeight: number,
): number | null {
  const riskySorted = [...risky].sort((left, right) => left.date.localeCompare(right.date));
  const safeSorted = [...safe].sort((left, right) => left.date.localeCompare(right.date));
  if (riskySorted.length === 0 || safeSorted.length === 0) return null;
  const months = [...new Set(riskySorted
    .filter((point) => point.date >= from && point.date <= to)
    .map((point) => point.date.slice(0, 7)))].sort();
  const startRisky = closeAtOrAfter(riskySorted, from);
  const startSafe = closeAtOrAfter(safeSorted, from);
  if (!startRisky || !startSafe || months.length === 0) return null;

  let index = 1;
  let riskyBase = startRisky.close;
  let safeBase = startSafe.close;
  let moved = false;
  for (const month of months) {
    const lastDay = `${month}-31`;
    const riskyEnd = closeAtOrBefore(riskySorted, lastDay);
    const safeEnd = closeAtOrBefore(safeSorted, lastDay);
    if (!riskyEnd || !safeEnd) continue;
    const riskyGrowth = riskyEnd.close / riskyBase;
    const safeGrowth = safeEnd.close / safeBase;
    if (!Number.isFinite(riskyGrowth) || !Number.isFinite(safeGrowth)) continue;
    const blended = riskyWeight * riskyGrowth + (1 - riskyWeight) * safeGrowth;
    if (blended <= 0) continue;
    if (riskyEnd.close !== riskyBase || safeEnd.close !== safeBase) moved = true;
    index *= blended;
    riskyBase = riskyEnd.close;
    safeBase = safeEnd.close;
  }
  return moved ? (index - 1) * 100 : null;
}
