import type {
  ExchangeRates,
  HoldingMetric,
  PortfolioMetrics,
  PortfolioState,
} from './types';
import { loadExchangeRates, toUsd } from './exchangeRates';
import { isCashEquivalent } from './assetClass';

export function computeMetrics(state: PortfolioState, rates: ExchangeRates = loadExchangeRates()): PortfolioMetrics {
  const unconvertedItems: string[] = [];
  const holdingsMetricsBase = state.holdings.map((h): Omit<HoldingMetric, 'weight'> => {
    const multiplier = h.assetType === 'option' ? h.option?.contractMultiplier ?? 100 : 1;
    const marketValueNative = h.marketValueOverride ?? h.shares * h.currentPrice * multiplier;
    const costKnownNative = h.costOverride != null || (h.shares > 0 && h.buyPrice > 0);
    const costNative = h.costOverride ?? (costKnownNative ? h.shares * h.buyPrice * multiplier : 0);
    const marketValue = toUsd(marketValueNative, h.currency, rates);
    const cost = toUsd(costNative, h.currency, rates);
    const dayChangeNative = h.quote?.change != null ? h.shares * multiplier * h.quote.change : 0;
    const dayChange = toUsd(dayChangeNative, h.currency, rates);
    if (marketValue === null || cost === null) {
      unconvertedItems.push(h.symbol || h.name || '未命名持仓');
    }
    const safeMarketValue = marketValue ?? 0;
    const safeCost = costKnownNative && cost !== null ? cost : 0;
    const costKnown = costKnownNative && cost !== null;
    const pnl = costKnown ? safeMarketValue - safeCost : 0;
    const pnlPct = costKnown && safeCost > 0 ? pnl / safeCost : 0;
    const option = h.assetType === 'option' ? h.option : undefined;
    const deltaEquivalentShares = option?.delta == null ? null : h.shares * multiplier * option.delta;
    const deltaAdjustedExposure =
      deltaEquivalentShares != null && option?.underlyingPrice != null
        ? toUsd(deltaEquivalentShares * option.underlyingPrice, h.currency, rates)
        : null;
    return {
      holding: h,
      marketValueNative,
      costNative,
      marketValue: safeMarketValue,
      cost: safeCost,
      costKnown,
      pnl,
      pnlPct,
      dayChange: dayChange ?? 0,
      dayChangeNative,
      dayChangePct: h.quote?.changePercent ?? null,
      deltaEquivalentShares,
      deltaAdjustedExposure,
    };
  });

  const equityValue = holdingsMetricsBase.reduce((s, m) => s + m.marketValue, 0);
  const cashValue = state.cash.reduce((s, c, index) => {
    const converted = toUsd(c.amount, c.currency, rates);
    if (converted === null) {
      unconvertedItems.push(`现金条目 ${index + 1}`);
      return s;
    }
    return s + converted;
  }, 0);
  const totalValue = equityValue + cashValue;
  const cashEquivalentValue = holdingsMetricsBase.reduce(
    (sum, metric) => sum + (isCashEquivalent(metric.holding) ? metric.marketValue : 0),
    0,
  );
  const liquidityValue = cashValue + cashEquivalentValue;
  const totalCost = holdingsMetricsBase.reduce((s, m) => s + m.cost, 0) + cashValue;
  const knownCostSum = holdingsMetricsBase.reduce(
    (sum, metric) => sum + (metric.costKnown ? metric.cost : 0),
    0,
  );
  const totalPnl = holdingsMetricsBase.reduce((s, m) => s + m.pnl, 0);
  const totalPnlPct = knownCostSum > 0 ? totalPnl / knownCostSum : 0;
  const dayChange = holdingsMetricsBase.reduce((s, m) => s + m.dayChange, 0);
  const previousTotalValue = totalValue - dayChange;
  const dayChangePct = previousTotalValue > 0 ? dayChange / previousTotalValue : 0;

  const holdingsMetrics: HoldingMetric[] = holdingsMetricsBase.map((m) => ({
    ...m,
    weight: totalValue > 0 ? m.marketValue / totalValue : 0,
  }));

  const sectorWeights: Record<string, number> = {};
  const underlyingExposure: Record<string, number> = {};
  for (const m of holdingsMetrics) {
    const key = m.holding.sector || '未分类';
    sectorWeights[key] = (sectorWeights[key] ?? 0) + m.weight;
    if (m.holding.assetType === 'option' && m.deltaAdjustedExposure == null) continue;
    const exposureKey = m.holding.assetType === 'option' ? m.holding.option?.underlying || m.holding.symbol : m.holding.symbol;
    const exposure = m.holding.assetType === 'option' ? m.deltaAdjustedExposure ?? 0 : m.marketValue;
    if (exposureKey) underlyingExposure[exposureKey] = (underlyingExposure[exposureKey] ?? 0) + exposure;
  }

  const optionValue = holdingsMetrics.reduce(
    (sum, metric) => sum + (metric.holding.assetType === 'option' ? metric.marketValue : 0),
    0,
  );
  const deltaAdjustedExposure = holdingsMetrics.reduce(
    (sum, metric) => sum + (metric.deltaAdjustedExposure ?? 0),
    0,
  );

  return {
    totalValue,
    totalCost,
    knownCostSum,
    totalPnl,
    totalPnlPct,
    dayChange,
    dayChangePct,
    equityValue,
    cashValue,
    cashWeight: totalValue > 0 ? cashValue / totalValue : 0,
    cashEquivalentValue,
    liquidityValue,
    liquidityWeight: totalValue > 0 ? liquidityValue / totalValue : 0,
    holdingsMetrics,
    sectorWeights,
    optionValue,
    optionWeight: totalValue > 0 ? optionValue / totalValue : 0,
    deltaAdjustedExposure,
    underlyingExposure,
    unconvertedItems,
    unknownCostItems: holdingsMetrics.filter((metric) => !metric.costKnown).length,
  };
}

export function sortHoldingMetrics(metrics: HoldingMetric[]): HoldingMetric[] {
  return [...metrics].sort((left, right) => right.marketValue - left.marketValue);
}
