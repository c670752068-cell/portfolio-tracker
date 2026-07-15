import {
  leverageFactorFor,
  leverageFactorForSymbol,
  leverageUnderlyingFor,
  leverageUnderlyingForSymbol,
} from './leverageMap';
import type { Holding, HoldingMetric } from './types';

export type ScenarioKind = 'stock' | 'etf' | 'leveraged_etf' | 'option';

export interface ScenarioInput {
  family: string;
  holdings: HoldingMetric[];
  spot: number;
  targetPrice: number;
  days: number;
  totalAssets: number;
}

export interface ScenarioLine {
  id: string;
  symbol: string;
  name: string;
  kind: ScenarioKind;
  broker?: string;
  pnl: number;
  pnlPct: number;
}

export interface ScenarioExcluded {
  id: string;
  symbol: string;
  reason: string;
}

export interface ScenarioResult {
  lines: ScenarioLine[];
  totalPnl: number;
  totalPnlPctOfAssets: number;
  excluded: ScenarioExcluded[];
}

export interface ScenarioFamily {
  symbol: string;
  spot: number;
}

/**
 * Approximation contract:
 * - plain shares/ETFs: marketValue * underlying return;
 * - leveraged ETFs: marketValue * leverage factor * underlying return;
 * - long options: contracts * multiplier *
 *   (delta*dP + 0.5*gamma*dP^2 + theta*days), floored at -premium value.
 * IV changes, path-dependent leverage decay and American early exercise are not modeled.
 */
export function simulateScenario(input: ScenarioInput): ScenarioResult {
  const family = normalize(input.family);
  if (!Number.isFinite(input.spot) || input.spot <= 0 || !Number.isFinite(input.targetPrice) || input.targetPrice < 0) {
    return { lines: [], totalPnl: 0, totalPnlPctOfAssets: 0, excluded: [] };
  }
  const r = input.targetPrice / input.spot - 1;
  const dP = input.targetPrice - input.spot;
  const days = Math.max(0, Number.isFinite(input.days) ? input.days : 0);
  const lines: ScenarioLine[] = [];
  const excluded: ScenarioExcluded[] = [];

  for (const metric of input.holdings) {
    const holding = metric.holding;
    if (scenarioFamilyFor(holding) !== family) continue;
    const marketValue = finite(metric.marketValue);

    if (holding.assetType === 'option') {
      const option = holding.option;
      if (!option || option.delta == null || !Number.isFinite(option.delta)) {
        excluded.push({ id: holding.id, symbol: holding.symbol, reason: '缺少 Delta，无法参与期权情景计算' });
        continue;
      }
      const optionUnderlying = normalize(option.underlying || holding.symbol);
      const leveragedFamily = leverageUnderlyingForSymbol(optionUnderlying);
      let optionPriceChange = dP;
      if (leveragedFamily === family) {
        if (option.underlyingPrice == null || !Number.isFinite(option.underlyingPrice) || option.underlyingPrice <= 0) {
          excluded.push({ id: holding.id, symbol: holding.symbol, reason: '杠杆 ETF 期权缺少标的现价，无法换算到底层正股情景' });
          continue;
        }
        optionPriceChange = option.underlyingPrice * leverageFactorForSymbol(optionUnderlying) * r;
      }
      const gamma = option.gamma != null && Number.isFinite(option.gamma) ? option.gamma : 0;
      const theta = option.theta != null && Number.isFinite(option.theta) ? option.theta : 0;
      const premiumChange = option.delta * optionPriceChange
        + 0.5 * gamma * optionPriceChange * optionPriceChange
        + theta * days;
      const rawPnl = holding.shares * (option.contractMultiplier || 100) * premiumChange;
      const pnl = Math.max(rawPnl, -Math.max(0, marketValue));
      lines.push(lineFor(holding, 'option', pnl, marketValue));
      continue;
    }

    if (holding.assetType === 'leveraged_etf') {
      const pnl = marketValue * leverageFactorFor(holding) * r;
      lines.push(lineFor(holding, 'leveraged_etf', pnl, marketValue));
      continue;
    }

    const pnl = marketValue * r;
    lines.push(lineFor(holding, holding.assetType === 'etf' ? 'etf' : 'stock', pnl, marketValue));
  }

  const totalPnl = cleanNumber(lines.reduce((sum, line) => sum + line.pnl, 0));
  const totalAssets = Number.isFinite(input.totalAssets) ? input.totalAssets : 0;
  return {
    lines,
    totalPnl,
    totalPnlPctOfAssets: totalAssets > 0 ? totalPnl / totalAssets : 0,
    excluded,
  };
}

export function scenarioFamilyFor(holding: Holding): string {
  if (holding.assetType === 'option') {
    const optionUnderlying = normalize(holding.option?.underlying || holding.symbol);
    return normalize(leverageUnderlyingForSymbol(optionUnderlying) || optionUnderlying);
  }
  if (holding.assetType === 'leveraged_etf') {
    return normalize(leverageUnderlyingFor(holding) || holding.symbol);
  }
  return normalize(holding.symbol);
}

export function listScenarioFamilies(holdings: HoldingMetric[]): ScenarioFamily[] {
  const families = new Map<string, number>();

  for (const { holding } of holdings) {
    const family = scenarioFamilyFor(holding);
    if (!family) continue;
    const isPlainFamily = holding.assetType !== 'option'
      && holding.assetType !== 'leveraged_etf'
      && normalize(holding.symbol) === family;
    if (isPlainFamily && holding.currentPrice > 0) families.set(family, holding.currentPrice);
  }
  for (const { holding } of holdings) {
    const family = scenarioFamilyFor(holding);
    if (!family || families.has(family)) continue;
    const optionUnderlying = holding.assetType === 'option'
      ? normalize(holding.option?.underlying || holding.symbol)
      : '';
    const underlyingPrice = holding.assetType === 'option'
      && !leverageUnderlyingForSymbol(optionUnderlying)
      ? holding.option?.underlyingPrice
      : null;
    if (underlyingPrice != null && underlyingPrice > 0) families.set(family, underlyingPrice);
    else if (holding.assetType === 'leveraged_etf' && normalize(holding.symbol) === family && holding.currentPrice > 0) {
      families.set(family, holding.currentPrice);
    }
  }

  return [...families.entries()]
    .map(([symbol, spot]) => ({ symbol, spot }))
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

function lineFor(holding: Holding, kind: ScenarioKind, pnl: number, marketValue: number): ScenarioLine {
  const cleanPnl = cleanNumber(pnl);
  return {
    id: holding.id,
    symbol: holding.symbol,
    name: holding.name || holding.symbol,
    kind,
    broker: holding.broker,
    pnl: cleanPnl,
    pnlPct: marketValue > 0 ? cleanNumber(cleanPnl / marketValue) : 0,
  };
}

function normalize(value: string): string {
  return value.trim().toUpperCase();
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function cleanNumber(value: number): number {
  return Math.round(value * 1e10) / 1e10;
}
