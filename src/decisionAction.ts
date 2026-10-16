import { buildCompactBuyDecision } from './compactBuyDecision';
import type { SmaIndicators } from './decisionIndicators';
import { finalVerdictFreshness, finalVerdictSymbols, isQuantAnalysisStale } from './quantAnalysis';
import { findSellFamily, hasSellValuationConflict } from './sellStatus';
import type { QuantAnalysisSnapshot } from './types';

export type DecisionActionKind = 'buy' | 'sell' | 'hold' | 'wait' | 'review';
export interface DecisionAction {
  kind: DecisionActionKind;
  label: string;
  reason: string;
  next: string;
  detail: string;
}

const result = (kind: DecisionActionKind, label: string, reason: string, next: string, detail = reason): DecisionAction => ({ kind, label, reason, next, detail });
const review = (reason: string, next = '核对数据后再判断', detail = reason) => result('review', '待核查', reason, next, detail);
const invalidTime = (stamp: string | null | undefined, now: number) => !stamp || !Number.isFinite(Date.parse(stamp)) || Date.parse(stamp) > now + 5 * 60_000 || isQuantAnalysisStale(stamp, now);

/** Presentation only: consume existing BUY/SELL rules, never promote Z/PE/SMA into an order. */
export function decisionAction(snapshot: QuantAnalysisSnapshot, symbol: string, held: boolean, sma?: SmaIndicators, now = Date.now()): DecisionAction {
  const verdict = finalVerdictSymbols(snapshot)[symbol];
  const buy = buildCompactBuyDecision(snapshot, symbol);
  const match = findSellFamily(snapshot, symbol);
  const family = match?.family;
  const sell = family?.decision;
  if (invalidTime(snapshot.generated_at, now) || snapshot.freshness?.data_stale || finalVerdictFreshness(snapshot)?.data_stale || verdict?.data_stale) {
    return review('判断数据已过期或时间无效', '刷新快照，不沿用旧结论');
  }

  // Family advice can cover options or leveraged proxies. Never relabel it as a stock order.
  const exactScope = !match?.multipleHeldMatches && family?.held_symbols.length === 1 && family.held_symbols[0] === symbol
    && (family.positions?.length ?? 0) > 0 && family.positions!.every(position => position.symbol === symbol && position.asset_type !== 'option' && position.quantity > 0);
  if (held && (!sell || invalidTime(snapshot.freshness?.sell_evaluated_at, now))) {
    return review('持仓卖出判断缺失或已过期', '更新卖出判断，不能据此确认持有');
  }
  if (sell?.verdict === 'SELL' && (held || family?.held_symbols.includes(symbol))) {
    if (invalidTime(snapshot.freshness?.sell_evaluated_at, now)) return review('卖出判断已过期', '刷新后查看卖出计划');
    if (buy.ready) return review('买入与卖出结论同时触发', '先核对买卖计划及持仓范围', sell.reason);
    if (!held || !exactScope) return review('卖出结论包含组合或衍生品', '到“卖出”页核对具体持仓', sell.reason);
    if (hasSellValuationConflict(family!, snapshot.pe_history)) return review('卖出与估值数据不一致', '刷新并核对同口径 PE', sell.reason);
    const reduction = sell.recommended_sell_pct;
    if (!Number.isFinite(reduction) || reduction <= 0 || reduction > 100) return review('卖出比例尚不完整', '核对原始卖出计划', sell.reason);
    return result('sell', reduction === 100 ? '按计划卖出' : '按计划减仓', '已有卖出规则触发', `核对计划：减持 ${reduction}% 持仓`, sell.reason);
  }
  if (!verdict || !['BUY', 'NO_BUY', 'UNDECIDABLE'].includes(verdict.verdict)) return review('缺少正式买入裁决', '等待服务器补齐判断');
  if (verdict.verdict === 'UNDECIDABLE' || verdict.unknown_layers?.length || snapshot.symbols[symbol]?.available === false) return review('判断所需数据不完整', '补齐数据，不把未知当机会', verdict.single_sentence || buy.message);
  if (verdict.verdict === 'BUY') {
    if (!buy.ready) return review('买入裁决与回撤依据不一致', '刷新并核对买入条件', buy.message);
    return result('buy', held ? '可按计划加仓' : '可按计划买入', '回撤到位，正式买入条件通过', '按原计划核对仓位与分批额度', verdict.single_sentence || buy.message);
  }
  const entryWaiting = buy.gapPct != null && buy.gapPct > 0;
  const nextBuy = entryWaiting && buy.targetPrice != null
    ? `关注 ${buy.priceLabel} 回撤参考价 $${buy.targetPrice.toFixed(2)}` : '等待原买入条件通过';
  if (!held) {
    return result('wait', '等待机会', entryWaiting ? `回撤距参考线还差 ${buy.gapPct!.toFixed(2)} 个百分点` : '正式买入条件尚未通过', nextBuy, verdict.single_sentence || buy.message);
  }
  if (!exactScope) return review('持仓判断涉及组合或衍生品', '到“卖出”页核对，不套用为单股持有', sell?.reason);
  if (sell?.verdict !== 'WAIT') return review('持仓判断状态不完整');
  const evidence = sell.evidence;
  if (!evidence || !['ready', 'loss', 'below_ladder'].includes(evidence.profit.status) || !Number.isFinite(evidence.profit.pnl_pct) || !family?.profit_gate?.available) return review('持仓成本不完整', '补齐成本后再评估止盈', sell.reason);
  if (!['normal', 'near', 'high', 'not_applicable'].includes(evidence.valuation.status) || !['far', 'near', 'reached'].includes(evidence.history.status) || !['normal', 'near_greed', 'greed'].includes(evidence.sentiment.status)) {
    return review('持仓判断依据不完整', '查看缺失依据，不据此确认持有', sell.reason);
  }
  if (snapshot.exposure_bands?.level === 'warning' || snapshot.exposure_bands?.level === 'danger') return review('组合已有敞口风险提示', '先查看组合风险，再核对持有计划');
  if (!sma?.asOf || sma.slope200 == null || (verdict.data_as_of && sma.asOf < verdict.data_as_of)) return review('长期趋势数据待更新', '补齐趋势后再确认持有', sell.reason);
  if (sma.severe) return review(sma.riskLabel, '复核趋势与基本面，不自动判定卖出', `卖出规则仍为“再等等”；${sell.reason}。200DMA 为技术风险提示，不代表业绩暴雷。`);
  return result('hold', '继续持有', '当前未触发正式卖出条件', sell.notification_state === 'near' ? '接近卖出条件，关注下一次判断' : '关注卖出条件变化；不因 Z 转正就卖出', sell.reason);
}
