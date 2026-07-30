import type { QuantFinalVerdict, QuantFinalVerdictLayer } from './types';

/**
 * Helpers for the daily "silence broadcast" (二十七期 T4 / W1 / W2).
 *
 * Every value here is re-arranged from fields the quant service already
 * emitted — layer states, gaps and trigger prices.  Nothing is judged,
 * derived or invented on the client.
 */

const LAYER_LABELS: Record<string, string> = {
  gates_six: '六关',
  entry_gate_1x: '1x 入场门',
  sleeve_borrow: '板块额度',
  buy_plan_conditions: '计划条件',
  panic_window: '恐慌窗口',
};

function layerLabel(layer: QuantFinalVerdictLayer): string {
  return layer.label ?? LAYER_LABELS[layer.layer] ?? layer.layer;
}

function failingLayers(verdict: QuantFinalVerdict): QuantFinalVerdictLayer[] {
  return (verdict.layers ?? []).filter((layer) => layer.state === 'failed');
}

/**
 * The backend currently repeats one blocking reason as a `另有` clause
 * (需求单-量化侧 Q-1).  Until that is fixed upstream we drop the duplicate
 * instead of showing the same sentence twice.
 */
export function dedupeVerdictSentence(sentence: string): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const segment of sentence.split('；')) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const key = trimmed.replace(/^另有/, '').replace(/^(?:不买|买入|条件完整|无法判定)[：:]/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(trimmed);
  }
  return kept.join('；');
}

export interface NearestVerdict {
  symbol: string;
  passedCount: number;
  totalCount: number;
  blockingLabels: string[];
}

/**
 * Which symbol is closest to its buy conditions.  This is a ranking of the
 * server's own layer states, not a buy signal — the verdict stays NO_BUY.
 */
export function nearestVerdict(verdicts: QuantFinalVerdict[]): NearestVerdict | null {
  const candidates = verdicts.filter((item) => item.verdict === 'NO_BUY' && (item.layers?.length ?? 0) > 0);
  if (candidates.length === 0) return null;

  const scored = candidates.map((item) => {
    const failing = failingLayers(item);
    const gaps = failing.map((layer) => layer.gap_pp).filter((gap): gap is number => typeof gap === 'number' && Number.isFinite(gap));
    return {
      item,
      failingCount: failing.length,
      minGap: gaps.length > 0 ? Math.min(...gaps) : Number.POSITIVE_INFINITY,
    };
  });
  scored.sort((left, right) => left.failingCount - right.failingCount
    || left.minGap - right.minGap
    || left.item.symbol.localeCompare(right.item.symbol));

  const winner = scored[0].item;
  const layers = winner.layers ?? [];
  return {
    symbol: winner.symbol,
    passedCount: layers.filter((layer) => layer.state === 'passed' || layer.state === 'not_applicable').length,
    totalCount: layers.length,
    blockingLabels: failingLayers(winner).map(layerLabel),
  };
}

/**
 * 「需要什么」— a failing layer's remaining gap expressed as the price the
 * user can wait for.  Both the price and the gap come from the payload.
 */
export function layerRequirements(verdict: QuantFinalVerdict): string[] {
  return failingLayers(verdict)
    .filter((layer) => typeof layer.trigger_price === 'number' && Number.isFinite(layer.trigger_price))
    .map((layer) => {
      const target = layer.benchmark ?? verdict.symbol;
      const price = layer.trigger_price!.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const gap = typeof layer.gap_pp === 'number' && Number.isFinite(layer.gap_pp)
        ? `（还差 ${layer.gap_pp.toFixed(2)}pp）`
        : '';
      return `需要：${target} 跌到 $${price}${gap}`;
    });
}
