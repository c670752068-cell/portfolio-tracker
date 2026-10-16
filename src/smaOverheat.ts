import type { QuantMaSlopeDashboard } from './types';

export const OVERHEAT_RULE = { years: 5, slopeWindow: 8, peakRadius: 5, horizon: 10, declinePct: 3, minEvents: 8, minBars: 252 } as const;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const median = (values: number[]) => {
  const ordered = values.toSorted((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length ? (ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2) : null;
};

/** Direction +1: positive peaks before pullbacks; -1: negative troughs before rebounds.
 * Descriptive and retrospective, never a tradable backtest or a reversal probability. */
function smaReversalSamples(dashboard: QuantMaSlopeDashboard | null | undefined, direction: 1 | -1) {
  const eligible = dashboard?.slope_window_sessions === 8 && dashboard.slope_unit === 'pct_per_day';
  const closed = eligible ? dashboard.series.filter(point => !point.is_partial).toSorted((a, b) => a.date.localeCompare(b.date)) : [];
  const end = closed.at(-1)?.date ?? null;
  const cutoff = end ? new Date(`${end}T00:00:00Z`) : null;
  cutoff?.setUTCFullYear(cutoff.getUTCFullYear() - OVERHEAT_RULE.years);
  const start = cutoff?.toISOString().slice(0, 10) ?? '';
  // Preserve invalid bars: filtering them out would bridge holes in the confirmation window.
  const points = closed.filter(point => point.date >= start);
  const candidates: Array<{ index: number; slope: number }> = [];
  const { peakRadius, horizon, declinePct } = OVERHEAT_RULE;
  for (let i = peakRadius; i + horizon < points.length; i++) {
    const slope = points[i].slope20;
    if (!finite(slope) || slope * direction <= 0 || !finite(points[i].close) || points[i].close <= 0) continue;
    const neighborhood = points.slice(i - peakRadius, i + peakRadius + 1);
    const future = points.slice(i + 1, i + horizon + 1);
    if (neighborhood.some(point => !finite(point.slope20)) || future.some(point => !finite(point.close) || point.close <= 0)) continue;
    // The first bar of a plateau is selected once. Multiplying by direction gives
    // exactly symmetric peak/trough rules without taking absolute-valued medians.
    if (points.slice(i - peakRadius, i).some(point => point.slope20! * direction >= slope * direction)
      || points.slice(i + 1, i + peakRadius + 1).some(point => point.slope20! * direction > slope * direction)) continue;
    candidates.push({ index: i, slope });
  }
  // Non-overlapping 10-session outcomes: keep the higher peak / lower trough.
  const independent: typeof candidates = [];
  for (const candidate of candidates.toSorted((a, b) => direction * (b.slope - a.slope) || a.index - b.index)) {
    if (independent.every(other => Math.abs(other.index - candidate.index) > horizon)) independent.push(candidate);
  }
  const events = independent.sort((a, b) => a.index - b.index).map(({ index, slope }) => {
    const future = points.slice(index + 1, index + horizon + 1);
    const extreme = future.reduce((a, b) => direction * (a.close - b.close) <= 0 ? a : b);
    const reversalPct = Math.max(0, direction * (1 - extreme.close / points[index].close) * 100);
    return { date: points[index].date, slope, close: points[index].close, extremeClose: extreme.close,
      extremeDate: extreme.date, confirmedThrough: future.at(-1)!.date, reversalPct, qualifies: reversalPct + 1e-10 >= declinePct };
  });
  const reversals = events.filter(event => event.qualifies);
  const values = reversals.map(event => event.slope);
  const barCount = points.filter(point => finite(point.slope20) && finite(point.close) && point.close > 0).length;
  return { meanSlope: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    medianSlope: median(values), extremeCount: events.length, reversalCount: reversals.length,
    observedReversalPct: events.length ? reversals.length / events.length * 100 : null,
    reliable: barCount >= OVERHEAT_RULE.minBars && reversals.length >= OVERHEAT_RULE.minEvents,
    barCount, historyStart: points[0]?.date ?? null, asOf: end, events,
    fullFiveYears: Boolean(end && points[0]?.date && (Date.parse(end) - Date.parse(points[0].date)) / 86_400_000 >= 1820),
  };
}

/** Preserve the existing upside calculation and public fields. */
export function smaOverheat(dashboard?: QuantMaSlopeDashboard | null) {
  const { meanSlope, medianSlope, extremeCount, reversalCount, observedReversalPct, events, ...coverage } = smaReversalSamples(dashboard, 1);
  return { ...coverage, meanPeak: meanSlope, medianPeak: medianSlope, peakCount: extremeCount,
    pullbackCount: reversalCount, observedPullbackPct: observedReversalPct,
    events: events.map(({ extremeClose, extremeDate, reversalPct, ...event }) => ({ ...event,
      lowestClose: extremeClose, lowestDate: extremeDate, drawdownPct: reversalPct })),
  };
}

/** Independent negative slope troughs followed by a >=3% closing-price rebound in 10 sessions. */
export function smaDownside(dashboard?: QuantMaSlopeDashboard | null) {
  const { meanSlope, medianSlope, extremeCount, reversalCount, observedReversalPct, events, ...coverage } = smaReversalSamples(dashboard, -1);
  return { ...coverage, meanTrough: meanSlope, medianTrough: medianSlope, troughCount: extremeCount,
    reboundCount: reversalCount, observedReboundPct: observedReversalPct,
    events: events.map(({ extremeClose, extremeDate, reversalPct, ...event }) => ({ ...event,
      highestClose: extremeClose, highestDate: extremeDate, reboundPct: reversalPct })),
  };
}
export type SmaOverheat = ReturnType<typeof smaOverheat>;
export type SmaDownside = ReturnType<typeof smaDownside>;
