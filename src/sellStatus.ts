import type { QuantAnalysisSnapshot, QuantSellFamily } from './types';

export type SellState = 'window_open' | 'observation' | 'none';

export interface ResolvedSellStatus {
  state: SellState;
  trigger?: string;
  detail?: string;
}

export interface SellFamilyMatch {
  family: QuantSellFamily;
  matchType: 'family' | 'held_symbol';
  multipleHeldMatches: boolean;
}

export function findSellFamily(
  snapshot: QuantAnalysisSnapshot | null | undefined,
  symbol: string,
): SellFamilyMatch | undefined {
  const normalized = symbol.trim().toUpperCase();
  if (!snapshot?.sell || !normalized) return undefined;
  const families = Object.values(snapshot.sell.symbols);
  const exact = families.find((item) => item.family.toUpperCase() === normalized);
  if (exact) return { family: exact, matchType: 'family', multipleHeldMatches: false };

  const heldMatches = families
    .filter((item) => item.held_symbols.some((heldSymbol) => heldSymbol.toUpperCase() === normalized))
    .sort((left, right) => right.market_value - left.market_value);
  if (heldMatches.length === 0) return undefined;
  return {
    family: heldMatches[0],
    matchType: 'held_symbol',
    multipleHeldMatches: heldMatches.length > 1,
  };
}

export function resolveSellStatus(
  snapshot: QuantAnalysisSnapshot | null | undefined,
  symbol: string,
): ResolvedSellStatus {
  const normalized = symbol.trim().toUpperCase();
  if (!snapshot?.sell || !normalized) return { state: 'none' };

  const familyMatch = findSellFamily(snapshot, normalized);
  if (!familyMatch) return { state: 'none' };

  const evidence = snapshot.summary?.sell_ready.find(
    (item) => item.symbol.toUpperCase() === familyMatch.family.family.toUpperCase(),
  );
  if (!evidence) return { state: 'none' };

  return {
    state: snapshot.sell.shadow || evidence.shadow ? 'observation' : 'window_open',
    trigger: evidence.trigger,
    detail: evidence.detail,
  };
}
