// 日志页的仓位标注：按 1 倍市值算仓位（现金和现金类 ETF 算空仓），对照当前的仓位上限。
// 只做提醒，防止不小心买多，不自动交易。
import { buildOptionBudget, type OptionBudgetLine } from './allocation';
import { cnnScoreFrom } from './marketStatusBar';
import type { PanicDrop } from './panicDrop';
import type { PortfolioMetrics, QuantAnalysisSnapshot } from './types';

// 仓位上限：没有恐慌性下跌不能超过 30%；CNN 20 以内才能超过 30%；VIX 25 以上才能到 50%，最大就是 50%。
const BASE_CAP = 30;
const MID_CAP = 40;
const MAX_CAP = 50;
export const CNN_UNLOCK = 20;
export const VIX_UNLOCK = 25;
const TQQQ_MIN_SPY_DEPTH = 5;

export interface CapSignals {
  panicOpen: boolean | null;
  cnn: number | null;
  vix: number | null;
}

export interface PositionGuard {
  positionPct: number;
  capPct: number | null;
  /** 超出上限几个百分点；没超是 null。 */
  overPct: number | null;
  overValue: number | null;
  signals: CapSignals;
  tqqqBlocked: boolean;
  tqqqShares: number;
  tqqqOptions: number;
  /** 期权额度（和总览一样）：总共 5%，其中 TQQQ 期权 3%；没超看还剩多少，超了看超出多少。 */
  options: { total: OptionBudgetLine; tqqq: OptionBudgetLine };
}

export function positionCap({ panicOpen, cnn, vix }: CapSignals): number | null {
  if (panicOpen === null) return null;
  if (!panicOpen) return BASE_CAP;
  if (cnn === null) return null;
  if (cnn > CNN_UNLOCK) return BASE_CAP;
  if (vix === null) return null;
  return vix >= VIX_UNLOCK ? MAX_CAP : MID_CAP;
}

export function capSignalsFrom(snapshot: QuantAnalysisSnapshot | null, panic: PanicDrop | null): CapSignals {
  const raw = snapshot?.context?.vix;
  const vix = typeof raw === 'object' && raw !== null ? raw as { available?: unknown; value?: unknown } : null;
  return {
    panicOpen: panic?.windowOpen ?? null,
    cnn: cnnScoreFrom(snapshot).score,
    vix: vix?.available === true && typeof vix.value === 'number' && Number.isFinite(vix.value) ? vix.value : null,
  };
}

export function positionGuard(
  metrics: PortfolioMetrics | null, spyDrawdownPct: number | null, signals: CapSignals,
): PositionGuard | null {
  if (!metrics || !(metrics.totalValue > 0)) return null;
  const positionPct = (1 - metrics.liquidityValue / metrics.totalValue) * 100;
  const tqqqShares = metrics.holdingsMetrics
    .filter((metric) => metric.holding.assetType !== 'option' && metric.holding.symbol.trim().toUpperCase() === 'TQQQ')
    .reduce((sum, metric) => sum + Math.abs(metric.marketValue), 0);
  const budget = buildOptionBudget(metrics);
  const tqqqOptions = budget.tqqq.value;
  const capPct = positionCap(signals);
  const over = capPct === null ? 0 : positionPct - capPct;
  return {
    positionPct,
    capPct,
    overPct: over > 0 ? over : null,
    overValue: over > 0 ? metrics.totalValue * over / 100 : null,
    signals,
    tqqqBlocked: spyDrawdownPct !== null && spyDrawdownPct > -TQQQ_MIN_SPY_DEPTH && tqqqShares + tqqqOptions > 0,
    tqqqShares,
    tqqqOptions,
    options: { total: budget.total, tqqq: budget.tqqq },
  };
}

export interface PositionBadge { text: string; over: boolean | null }

/** 决策页 CNN、VIX 卡片上的徽章：当前仓位、上限、超没超，一眼看懂。 */
export function positionBadge(guard: PositionGuard | null): PositionBadge | null {
  if (!guard) return null;
  const head = `仓位 ${guard.positionPct.toFixed(1)}%`;
  if (guard.capPct === null) return { text: `${head} · 上限暂无`, over: null };
  const over = guard.overPct !== null;
  return { text: `${head} · 上限 ${guard.capPct}% · ${over ? '超了' : '没超'}`, over };
}
