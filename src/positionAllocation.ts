import { toUsd } from './exchangeRates';
import { leverageInfoForSymbol, leverageUnderlyingForSymbol } from './leverageMap';
import type { ExchangeRates, Holding } from './types';

const PLAIN_ETFS = new Set([
  'COPX', 'DIA', 'FNGS', 'GDX', 'GLD', 'IGV', 'IWM', 'MAGS', 'QQQ', 'SGOV',
  'SLV', 'SOXX', 'SPY', 'VGT', 'VOO', 'VTI', 'XLK',
]);

export interface StockFamilyAllocation {
  family: string;
  currentPct: number;
  capPct: number;
  marketValueUsd: number;
  members: string[];
}

export function isThreeXSymbol(symbol: string): boolean {
  return (leverageInfoForSymbol(symbol)?.factor ?? 1) >= 3;
}

export function stockFamilyAllocation(
  symbol: string,
  holdings: readonly Holding[],
  totalAssets: number,
  rates: ExchangeRates,
): StockFamilyAllocation | null {
  const family = stockFamilyForSymbol(symbol, holdings);
  if (!family) return null;
  let marketValueUsd = 0;
  const members = new Set<string>();
  for (const holding of holdings) {
    if (holdingFamily(holding) !== family) continue;
    const multiplier = holding.assetType === 'option'
      ? holding.option?.contractMultiplier ?? 100
      : 1;
    const nativeValue = holding.marketValueOverride
      ?? holding.shares * holding.currentPrice * multiplier;
    const usdValue = toUsd(nativeValue, holding.currency, rates);
    if (usdValue === null || !Number.isFinite(usdValue)) continue;
    marketValueUsd += Math.abs(usdValue);
    members.add(holding.symbol.trim().toUpperCase());
  }
  return {
    family,
    currentPct: totalAssets > 0 ? marketValueUsd / totalAssets * 100 : 0,
    capPct: 10,
    marketValueUsd,
    members: [...members].sort(),
  };
}

function stockFamilyForSymbol(symbol: string, holdings: readonly Holding[]): string | null {
  const normalized = symbol.trim().toUpperCase();
  const leverage = leverageInfoForSymbol(normalized);
  if (leverage?.underlying) return leverage.underlying;
  if (leverage || PLAIN_ETFS.has(normalized)) return null;
  const exactHolding = holdings.find((holding) => holding.symbol.trim().toUpperCase() === normalized);
  if (exactHolding?.assetType === 'etf' || exactHolding?.assetType === 'fund') return null;
  return normalized;
}

function holdingFamily(holding: Holding): string {
  const raw = holding.assetType === 'option'
    ? holding.option?.underlying || holding.symbol
    : holding.symbol;
  const normalized = raw.trim().toUpperCase();
  return leverageUnderlyingForSymbol(normalized) || normalized;
}
