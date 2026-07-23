export interface PeTargetPrice {
  targetPrice: number | null;
  gapPct: number | null;
}

const ROUND_DIGITS = 6;

function positiveFinite(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function round(value: number): number {
  return Number(value.toFixed(ROUND_DIGITS));
}

export function computePeTargetPrice(
  currentPrice: number | null,
  currentPe: number | null,
  basisPe: number | null,
): PeTargetPrice {
  if (
    !positiveFinite(currentPrice)
    || !positiveFinite(currentPe)
    || !positiveFinite(basisPe)
  ) {
    return { targetPrice: null, gapPct: null };
  }
  const targetPrice = currentPrice * basisPe / currentPe;
  const gapPct = (targetPrice - currentPrice) / currentPrice * 100;
  if (!Number.isFinite(targetPrice) || !Number.isFinite(gapPct)) {
    return { targetPrice: null, gapPct: null };
  }
  return {
    targetPrice: round(targetPrice),
    gapPct: round(gapPct),
  };
}
