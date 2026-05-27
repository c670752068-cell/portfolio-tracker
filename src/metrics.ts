import type {
  HoldingMetric,
  PortfolioMetrics,
  PortfolioState,
} from './types';

export function computeMetrics(state: PortfolioState): PortfolioMetrics {
  const holdingsMetricsBase = state.holdings.map((h): Omit<HoldingMetric, 'weight'> => {
    const marketValue = h.shares * h.currentPrice;
    const cost = h.shares * h.buyPrice;
    const pnl = marketValue - cost;
    const pnlPct = cost > 0 ? pnl / cost : 0;
    return { holding: h, marketValue, cost, pnl, pnlPct };
  });

  const equityValue = holdingsMetricsBase.reduce((s, m) => s + m.marketValue, 0);
  const cashValue = state.cash.reduce((s, c) => s + c.amount, 0);
  const totalValue = equityValue + cashValue;
  const totalCost = holdingsMetricsBase.reduce((s, m) => s + m.cost, 0) + cashValue;
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? totalPnl / totalCost : 0;

  const holdingsMetrics: HoldingMetric[] = holdingsMetricsBase.map((m) => ({
    ...m,
    weight: totalValue > 0 ? m.marketValue / totalValue : 0,
  }));

  const sectorWeights: Record<string, number> = {};
  for (const m of holdingsMetrics) {
    const key = m.holding.sector || '未分类';
    sectorWeights[key] = (sectorWeights[key] ?? 0) + m.weight;
  }

  return {
    totalValue,
    totalCost,
    totalPnl,
    totalPnlPct,
    equityValue,
    cashValue,
    cashWeight: totalValue > 0 ? cashValue / totalValue : 0,
    holdingsMetrics,
    sectorWeights,
  };
}
