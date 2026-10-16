import type { DecisionTrade } from './decisionLog';

// 没有预判能力时的胜率，来自 2015-01～2026-10 的回测：在 QQQ 离前高 2% 以内的
// 任意一天卖出 TQQQ/TECL 各半，等 QQQ 从前高回撤 X% 再接回。
// 这两个基准只适合纳指类交易，个股交易标「无基准」。
export const NO_SKILL_BASELINE = { dip5: 0.5, dip10: 0.62 } as const;
export const MIN_RELIABLE_SAMPLES = 10;
const UNRELIABLE_NOTE = '样本太少，结论不可靠';

export interface DecisionStatGroup {
  key: string;
  label: string;
  samples: number;
  hits: number;
  pending: number;
  expired: number;
  hitRate: number | null;
  baseline: number | null;
  baselineGapPp: number | null;
  avgVsHoldPct: number | null;
  cumulativeVsHoldUsd: number | null;
  reliable: boolean;
  note: string;
}

interface Bucket {
  key: string;
  label: string;
  baseline: number | null;
  counted: boolean;
  trades: DecisionTrade[];
}

function bucketFor(trade: DecisionTrade): Omit<Bucket, 'trades'> | null {
  const prediction = trade.prediction;
  if (!prediction || prediction.type === 'none') return null;
  if (prediction.type === 'rebuy_after_dip') {
    const reference = (prediction.reference_symbol || 'QQQ').toUpperCase();
    const dip = prediction.dip_pct ?? null;
    if (reference === 'QQQ' && dip === 5) {
      return { key: 'rebuy_after_dip_5', label: '卖出后等回调 5% 接回', baseline: NO_SKILL_BASELINE.dip5, counted: true };
    }
    if (reference === 'QQQ' && dip === 10) {
      return { key: 'rebuy_after_dip_10', label: '卖出后等回调 10% 接回', baseline: NO_SKILL_BASELINE.dip10, counted: true };
    }
    return { key: 'rebuy_after_dip_other', label: '卖出后等回调接回（其他参数）', baseline: null, counted: true };
  }
  if (prediction.type === 'target_price') {
    return { key: 'target_price', label: '买入后目标价', baseline: null, counted: true };
  }
  if (prediction.type === 'beat_qqq') {
    return { key: 'beat_qqq', label: '买入后跑赢 QQQ', baseline: null, counted: true };
  }
  // 止盈规则只记录走势，不参与命中率。
  return { key: 'take_profit_rule', label: '止盈规则', baseline: null, counted: false };
}

// 样本量和「有没有基准」是两件事，都要说清楚，所以拼在一起。
function noteFor(bucket: Bucket, samples: number, reliable: boolean): string {
  if (!bucket.counted) return '只展示走势，不计入命中率';
  const parts = [
    samples === 0 ? '还没有判定完成的样本' : reliable ? '' : UNRELIABLE_NOTE,
    bucket.baseline === null ? '无基准' : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildDecisionStats(trades: readonly DecisionTrade[]) {
  const buckets = new Map<string, Bucket>();
  let pendingNotes = 0;
  for (const trade of trades) {
    if (trade.status === 'pending_note') pendingNotes += 1;
    const bucket = bucketFor(trade);
    if (!bucket) continue;
    const existing = buckets.get(bucket.key) ?? { ...bucket, trades: [] };
    existing.trades.push(trade);
    buckets.set(bucket.key, existing);
  }

  const groups: DecisionStatGroup[] = [...buckets.values()].map((bucket) => {
    const resolved = bucket.trades.filter((trade) => trade.status === 'hit' || trade.status === 'miss');
    const hits = resolved.filter((trade) => trade.status === 'hit').length;
    const samples = resolved.length;
    const hitRate = bucket.counted && samples > 0 ? hits / samples : null;
    const vsHold = resolved
      .map((trade) => trade.vs_hold_pct)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const cumulative = resolved.reduce((sum, trade) => {
      const pct = trade.vs_hold_pct;
      const amount = trade.amount;
      if (typeof pct !== 'number' || !Number.isFinite(pct) || typeof amount !== 'number' || !Number.isFinite(amount)) return sum;
      return sum + amount * (pct / 100);
    }, 0);
    const reliable = bucket.counted && samples >= MIN_RELIABLE_SAMPLES;
    return {
      key: bucket.key,
      label: bucket.label,
      samples,
      hits,
      pending: bucket.trades.filter((trade) => trade.status === 'in_progress').length,
      expired: bucket.trades.filter((trade) => trade.status === 'expired').length,
      hitRate,
      baseline: bucket.counted ? bucket.baseline : null,
      baselineGapPp: hitRate !== null && bucket.baseline !== null ? (hitRate - bucket.baseline) * 100 : null,
      avgVsHoldPct: average(vsHold),
      cumulativeVsHoldUsd: vsHold.length === 0 ? null : cumulative,
      reliable,
      note: noteFor(bucket, samples, reliable),
    };
  }).sort((left, right) => right.samples - left.samples || left.key.localeCompare(right.key));

  return {
    groups,
    pendingNotes,
    totalResolved: groups.reduce((sum, group) => sum + group.samples, 0),
  };
}
