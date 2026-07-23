import type { PePoint } from './peData';

export interface StockBasisResult {
  mean5y: number | null;
  current: number | null;
  deviationPct: number | null;
  sampleMonths: number;
}

export interface AnchorBasisResult {
  anchorPe: number | null;
  anchorDate: string | null;
  current: number | null;
  gapPct: number | null;
  zone: 'at_anchor' | 'near_anchor' | 'far' | 'unknown';
}

export interface AnchorThresholds {
  atAnchorPct: number;
  nearAnchorPct: number;
}

const FIVE_YEARS_DAYS = 1825;
const DAY_MS = 24 * 60 * 60 * 1000;
const AVERAGE_MONTH_DAYS = 365.25 / 12;
const DEFAULT_THRESHOLDS: AnchorThresholds = {
  atAnchorPct: 5,
  nearAnchorPct: 15,
};
const ROUND_DIGITS = 6;

export function computeStock5yMean(
  series: PePoint[],
  current: number | null,
): StockBasisResult {
  const valid = validPoints(series);
  const currentValue = positiveNumber(current);
  if (valid.length === 0) {
    return {
      mean5y: null,
      current: currentValue,
      deviationPct: null,
      sampleMonths: 0,
    };
  }

  const latestTime = Math.max(...valid.map((point) => Date.parse(point.date)));
  const cutoff = latestTime - FIVE_YEARS_DAYS * DAY_MS;
  const lookback = valid.filter((point) => Date.parse(point.date) >= cutoff);
  const mean = lookback.reduce((sum, point) => sum + point.value, 0) / lookback.length;
  const firstTime = Math.min(...lookback.map((point) => Date.parse(point.date)));
  const sampleMonths = Math.max(
    1,
    Math.floor((latestTime - firstTime) / DAY_MS / AVERAGE_MONTH_DAYS) + 1,
  );
  return {
    mean5y: round(mean),
    current: currentValue,
    deviationPct: currentValue === null ? null : round((currentValue - mean) / mean * 100),
    sampleMonths,
  };
}

export function computeIndexAnchor(
  series: PePoint[],
  current: number | null,
  window: { start: string; end: string },
  manualAnchor?: number,
  thresholds: AnchorThresholds = DEFAULT_THRESHOLDS,
): AnchorBasisResult {
  const currentValue = positiveNumber(current);
  const manualValue = positiveNumber(manualAnchor);
  const candidates = validPoints(series)
    .filter((point) => window.start <= point.date && point.date <= window.end);
  const minimum = candidates.reduce<PePoint | null>(
    (selected, point) => selected === null || point.value < selected.value ? point : selected,
    null,
  );
  const anchorPe = manualValue ?? minimum?.value ?? null;
  const anchorDate = manualValue !== null ? null : minimum?.date ?? null;
  if (
    currentValue === null
    || anchorPe === null
    || !validThresholds(thresholds)
  ) {
    return {
      anchorPe,
      anchorDate,
      current: currentValue,
      gapPct: null,
      zone: 'unknown',
    };
  }

  const gapPct = round((currentValue - anchorPe) / anchorPe * 100);
  const zone = gapPct <= thresholds.atAnchorPct
    ? 'at_anchor'
    : gapPct <= thresholds.nearAnchorPct
      ? 'near_anchor'
      : 'far';
  return {
    anchorPe: round(anchorPe),
    anchorDate,
    current: currentValue,
    gapPct,
    zone,
  };
}

function validPoints(series: PePoint[]): PePoint[] {
  return series
    .filter((point) => (
      typeof point.date === 'string'
      && Number.isFinite(Date.parse(point.date))
      && Number.isFinite(point.value)
      && point.value > 0
    ))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function validThresholds(value: AnchorThresholds): boolean {
  return Number.isFinite(value.atAnchorPct)
    && Number.isFinite(value.nearAnchorPct)
    && value.atAnchorPct >= 0
    && value.nearAnchorPct >= value.atAnchorPct;
}

function round(value: number): number {
  return Number(value.toFixed(ROUND_DIGITS));
}
