export interface DepthPriceView {
  currentPrice: number | null;
  highPrice: number | null;
  thresholdPrice: number | null;
  source: 'quant' | 'derived' | 'unavailable';
}

interface DepthPercentages {
  current_pct: number;
  threshold_pct: number;
}

export interface QuantDepthPrices {
  currentPrice: number | null;
  highPrice: number | null;
  thresholdPrice: number | null;
}

const ZERO_EPSILON = 1e-9;

function positiveFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function drawdownFactor(value: number): number {
  return 1 - Math.abs(value) / 100;
}

export function buildDepthPriceView(
  depth: DepthPercentages,
  quotePrice: number | null,
  quantPrice?: QuantDepthPrices,
): DepthPriceView {
  const quantCurrent = positiveFinite(quantPrice?.currentPrice);
  const quantHigh = positiveFinite(quantPrice?.highPrice);
  const quantThreshold = positiveFinite(quantPrice?.thresholdPrice);
  if (quantCurrent !== null && quantHigh !== null && quantThreshold !== null) {
    return {
      currentPrice: quantCurrent,
      highPrice: quantHigh,
      thresholdPrice: quantThreshold,
      source: 'quant',
    };
  }

  const currentPrice = positiveFinite(quotePrice);
  if (currentPrice === null) {
    return {
      currentPrice: null,
      highPrice: null,
      thresholdPrice: null,
      source: 'unavailable',
    };
  }

  const currentFactor = drawdownFactor(depth.current_pct);
  if (!Number.isFinite(currentFactor) || Math.abs(currentFactor) < ZERO_EPSILON) {
    return {
      currentPrice,
      highPrice: null,
      thresholdPrice: null,
      source: 'derived',
    };
  }
  const highPrice = currentPrice / currentFactor;
  const thresholdPrice = highPrice * drawdownFactor(depth.threshold_pct);
  return {
    currentPrice,
    highPrice: positiveFinite(highPrice),
    thresholdPrice: positiveFinite(thresholdPrice),
    source: 'derived',
  };
}
