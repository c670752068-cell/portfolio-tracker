import type { HoldingMetric, QuantAnalysisSnapshot } from './types';

export interface HoldingEmotionInsight {
  lossUsd: number;
  winRate60d: number | null;
  sampleCount: number;
  sampleInsufficient: boolean;
}

export interface LeverageRadarRow {
  symbol: string;
  ready: boolean;
  currentPct: number;
  thresholdPct: number;
  remainingPct: number;
  progressPct: number;
  currentPrice: number | null;
  thresholdPrice: number | null;
  priceSession: string;
}

const LEVERAGE_RADAR_SYMBOLS = ['TQQQ', 'FNGU', 'SOXL', 'TECL'] as const;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function positivePrice(value: unknown): number | null {
  return finite(value) && value > 0 ? value : null;
}

/**
 * Uses the already-verified portfolio metric instead of re-reading raw holding costs.
 * This preserves the option-cost guard and partial-cost handling used by the rest of the app.
 */
export function buildHoldingEmotionInsight(
  metric: HoldingMetric,
  snapshot: QuantAnalysisSnapshot,
): HoldingEmotionInsight | null {
  if (!metric.costKnown || !finite(metric.pnl) || metric.pnl >= 0) return null;

  const lookupSymbol = (metric.holding.option?.underlying || metric.holding.symbol).trim().toUpperCase();
  const depth = snapshot.symbols?.[lookupSymbol]?.depth_window;
  const sampleCount = depth && finite(depth.n) ? Math.max(0, depth.n) : 0;
  const sampleInsufficient = depth?.applicable !== true
    || depth.sample_insufficient !== false
    || !finite(depth.win_rate_60d)
    || sampleCount <= 0;

  return {
    lossUsd: Math.abs(metric.pnl),
    winRate60d: sampleInsufficient ? null : depth?.win_rate_60d ?? null,
    sampleCount,
    sampleInsufficient,
  };
}

export function buildLeverageRadarRows(snapshot: QuantAnalysisSnapshot): LeverageRadarRow[] {
  return LEVERAGE_RADAR_SYMBOLS.flatMap((symbol) => {
    const analysis = snapshot.symbols?.[symbol];
    const depth = analysis?.depth_window;
    if (
      analysis?.available !== true
      || depth?.applicable !== true
      || !finite(depth.current_pct)
      || !finite(depth.threshold_pct)
      || depth.threshold_pct <= 0
    ) {
      return [];
    }

    return [{
      symbol,
      ready: depth.open === true,
      currentPct: depth.current_pct,
      thresholdPct: depth.threshold_pct,
      remainingPct: Math.max(0, depth.threshold_pct - depth.current_pct),
      progressPct: Math.min(100, Math.max(0, (depth.current_pct / depth.threshold_pct) * 100)),
      currentPrice: positivePrice(depth.current_price),
      thresholdPrice: positivePrice(depth.threshold_price),
      priceSession: typeof depth.price_session === 'string' ? depth.price_session : '',
    }];
  });
}
