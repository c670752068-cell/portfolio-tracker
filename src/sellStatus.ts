import type { QuantAnalysisSnapshot } from './types';

export type SellState = 'window_open' | 'observation' | 'none';

export interface ResolvedSellStatus {
  state: SellState;
  trigger?: string;
  detail?: string;
}

export function resolveSellStatus(
  snapshot: QuantAnalysisSnapshot | null | undefined,
  symbol: string,
): ResolvedSellStatus {
  const normalized = symbol.trim().toUpperCase();
  if (!snapshot?.sell || !normalized) return { state: 'none' };

  const family = Object.values(snapshot.sell.symbols).find(
    (item) => item.family.toUpperCase() === normalized
      || item.held_symbols.some((heldSymbol) => heldSymbol.toUpperCase() === normalized),
  );
  if (!family) return { state: 'none' };

  const evidence = snapshot.summary?.sell_ready.find(
    (item) => item.symbol.toUpperCase() === family.family.toUpperCase(),
  );
  if (!evidence) return { state: 'none' };

  return {
    state: evidence.shadow ? 'observation' : 'window_open',
    trigger: evidence.trigger,
    detail: evidence.detail,
  };
}
