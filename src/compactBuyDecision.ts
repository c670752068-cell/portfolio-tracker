import { isHonestPass } from './gateHonesty';
import { depthConditionSatisfied, finalVerdictSymbols } from './quantAnalysis';
import type { QuantAnalysisSnapshot, QuantFinalVerdictLayer, QuantMaSlopeSnapshot } from './types';

export interface CompactBuyDecision {
  symbol: string;
  ready: boolean;
  label: '可以买' | '暂时不买' | '数据不足';
  message: string;
  currentDrawdownPct: number | null;
  thresholdPct: number | null;
  gapPct: number | null;
  currentPrice: number | null;
  highPrice: number | null;
  highPriceDate: string | null;
  targetPrice: number | null;
  priceLabel: string;
  excessPct: number;
  historicalMedianPct: number | null;
  historicalAveragePct: number | null;
  historicalSampleCount: number;
  historicalBasisSymbol: string;
  historicalSampleStatus: 'direct' | 'reference' | 'insufficient' | null;
  executionSource: string | null;
  executionAvailable: boolean;
  maSlope: QuantMaSlopeSnapshot | null;
}

export function buildCompactBuyDecision(
  snapshot: QuantAnalysisSnapshot,
  symbol: string,
): CompactBuyDecision {
  const analysis = snapshot.symbols?.[symbol];
  const depth = analysis?.depth_window;
  const historical = analysis?.historical_standard ?? depth?.historical_standard;
  const execution = analysis?.execution_standard ?? depth?.execution_standard;
  const verdict = finalVerdictSymbols(snapshot)[symbol];
  const entryLayer = verdict?.layers?.find((layer) => layer.layer === 'entry_gate_1x' && layer.applicable !== false && layer.state !== 'not_applicable');
  const thresholdPct = firstFinite(execution?.threshold_pct, depth?.threshold_pct);
  const depthReady = entryLayer
    ? layerPass(entryLayer) === true
    : Boolean(depth && (depthConditionSatisfied(snapshot, symbol) || depth.open));
  const presentationGap = finite(snapshot.summary?.depth_states?.[symbol]?.gap_pct);
  const calculatedGap = depth && thresholdPct !== null
    ? Math.max(0, thresholdPct - depth.current_pct)
    : null;
  const gapPct = depthReady
    ? 0
    : firstFinite(entryLayer?.gap_pp, presentationGap, calculatedGap);
  const highPrice = finite(depth?.high_price);
  const calculatedTargetPrice = highPrice !== null && thresholdPct !== null
    ? highPrice * (1 - Math.abs(thresholdPct) / 100)
    : null;
  const targetPrice = firstFinite(calculatedTargetPrice, entryLayer?.trigger_price, depth?.threshold_price, depth?.next_level_price);
  const priceLabel = entryLayer?.benchmark || execution?.basis_symbol || symbol;
  const currentDrawdownPct = finite(depth?.current_pct);
  const executionAvailable = execution?.execution_allowed ?? thresholdPct !== null;
  const excessPct = currentDrawdownPct !== null && thresholdPct !== null
    ? Math.max(0, currentDrawdownPct - thresholdPct)
    : 0;
  const localConditionsReady = executionAvailable && depthReady;
  const finalAuthorised = verdict?.verdict === 'BUY';
  const ready = localConditionsReady && finalAuthorised;
  const label = ready
    ? '可以买'
    : verdict?.verdict === 'UNDECIDABLE'
      ? '数据不足'
      : '暂时不买';
  const message = verdict?.verdict === 'UNDECIDABLE' && verdict.single_sentence
    ? verdict.single_sentence
    : localConditionsReady && !finalAuthorised
    ? verdict?.single_sentence || '最终买入许可未通过。'
    : executionAvailable
      ? decisionMessage({ ready, depthReady, gapPct, priceLabel, excessPct })
    : '历史样本不足，暂不生成确定买入线。';

  return {
    symbol,
    ready,
    label,
    message,
    currentDrawdownPct,
    thresholdPct,
    gapPct,
    currentPrice: finite(depth?.current_price),
    highPrice,
    highPriceDate: textOrNull(depth?.high_price_date),
    targetPrice,
    priceLabel,
    excessPct,
    historicalMedianPct: finite(historical?.median_drawdown_pct),
    historicalAveragePct: finite(historical?.average_drawdown_pct),
    historicalSampleCount: Number(historical?.sample_count || 0),
    historicalBasisSymbol: historical?.basis_symbol || execution?.basis_symbol || symbol,
    historicalSampleStatus: execution?.sample_status ?? historical?.sample_status ?? null,
    executionSource: execution?.source ?? null,
    executionAvailable,
    maSlope: analysis?.ma_slope ?? null,
  };
}

function decisionMessage({
  ready,
  depthReady,
  gapPct,
  priceLabel,
  excessPct,
}: {
  ready: boolean;
  depthReady: boolean;
  gapPct: number | null;
  priceLabel: string;
  excessPct: number;
}): string {
  if (ready) return `回撤已达到买入线，超出 ${excessPct.toFixed(2)} 个百分点；回撤越深，买入优先级越高。`;
  if (!depthReady && gapPct !== null) return `${priceLabel} 还需下跌 ${gapPct.toFixed(2)} 个百分点。`;
  if (depthReady) return '回撤已到位，等待后端最终风险许可。';
  return '回撤数据不完整，暂时不买。';
}

function layerPass(layer: QuantFinalVerdictLayer | undefined): boolean | null {
  if (!layer) return null;
  const passed = layer.passed ?? layer.state === 'passed';
  return isHonestPass(Boolean(passed), layer.reason) ? true : false;
}

function firstFinite(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric = finite(value);
    if (numeric !== null) return numeric;
  }
  return null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
