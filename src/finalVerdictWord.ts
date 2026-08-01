import type { QuantFinalVerdict } from './types';

/** 「条件完整」reads as "data is complete" and 「不买」reads as "the drawdown has not arrived"; both are wrong. */
export function finalVerdictWord(verdict: QuantFinalVerdict | undefined): string {
  if (!verdict) return '待更新';
  if (verdict.verdict === 'BUY') return '五层条件均已满足';
  if (verdict.verdict === 'NO_BUY') return '暂不满足';
  return '数据缺失，无法判定';
}
