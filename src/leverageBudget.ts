import { LEVERAGE_MAP } from './leverageMap';
import type { PortfolioMetrics } from './types';

// 杠杆 ETF 总市值不超过总资产的 50%（用户定的规则，只提醒不交易）。
// 总资产口径和期权预算一致：按当前市值，含现金和现金类 ETF。
export const LEVERAGE_BUDGET_CAP = 0.5;
// 达到上限的 80%（即总资产的 40%）就变黄。
export const LEVERAGE_BUDGET_WARN_RATIO = 0.8;
// 2022 年 TQQQ / TECL / SOXL 跌了 76%～90%，统一按 -80% 估算最坏情况。
export const LEVERAGE_CRASH_DRAWDOWN = 0.8;

export interface LeverageBudgetRow {
  symbol: string;
  name: string;
  marketValue: number;
  factor: number;
  exposure: number;
}

export interface LeverageBudgetSummary {
  rows: LeverageBudgetRow[];
  value: number;
  weight: number;
  cap: number;
  limitValue: number;
  remainingValue: number;
  overByValue: number;
  overLimit: boolean;
  nearLimit: boolean;
  exposure: number;
  exposureWeight: number;
  crashLossWeight: number;
}

// 手填的倍数优先，其次是内置对照表。反向 ETF 用负数，这里按绝对值占用额度；
// 不走 leverageFactorFor，免得负数倍数跑进饼图和情景计算器改掉别处的口径。
function budgetLeverageFactor(holding: PortfolioMetrics['holdingsMetrics'][number]['holding']): number | null {
  const manual = holding.leverageFactor;
  if (typeof manual === 'number' && Number.isFinite(manual) && Math.abs(manual) !== 1 && manual !== 0) return manual;
  const mapped = LEVERAGE_MAP[holding.symbol.trim().toUpperCase()]?.factor;
  return typeof mapped === 'number' && Number.isFinite(mapped) && Math.abs(mapped) !== 1 ? mapped : null;
}

export function buildLeverageBudget(metrics: PortfolioMetrics): LeverageBudgetSummary {
  const rows: LeverageBudgetRow[] = [];
  for (const metric of metrics.holdingsMetrics) {
    if (metric.holding.assetType === 'option' || metric.holding.cashEquivalent) continue;
    const factor = budgetLeverageFactor(metric.holding);
    if (factor === null) continue;
    const marketValue = Math.abs(metric.marketValue);
    if (marketValue <= 0) continue;
    rows.push({
      symbol: metric.holding.symbol,
      name: metric.holding.name,
      marketValue,
      factor,
      exposure: marketValue * Math.abs(factor),
    });
  }
  rows.sort((left, right) => right.exposure - left.exposure);

  const nav = Number.isFinite(metrics.totalValue) && metrics.totalValue > 0 ? metrics.totalValue : 0;
  const value = rows.reduce((sum, row) => sum + row.marketValue, 0);
  const exposure = rows.reduce((sum, row) => sum + row.exposure, 0);
  const limitValue = nav * LEVERAGE_BUDGET_CAP;
  const difference = value - limitValue;
  const overLimit = difference > 0.005;
  const weight = nav > 0 ? value / nav : 0;
  return {
    rows,
    value,
    weight,
    cap: LEVERAGE_BUDGET_CAP,
    limitValue,
    remainingValue: overLimit ? 0 : Math.max(0, -difference),
    overByValue: overLimit ? difference : 0,
    overLimit,
    nearLimit: !overLimit && weight >= LEVERAGE_BUDGET_CAP * LEVERAGE_BUDGET_WARN_RATIO,
    exposure,
    exposureWeight: nav > 0 ? exposure / nav : 0,
    // 杠杆仓按 -80% 估算，总资产大约少这么多比例。
    crashLossWeight: weight * LEVERAGE_CRASH_DRAWDOWN,
  };
}
