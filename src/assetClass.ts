import type { Holding } from './types';

export const CASH_EQUIVALENT_SYMBOLS: ReadonlySet<string> = new Set([
  'SGOV',
  'BIL',
  'SHV',
  'USFR',
  'BOXX',
  'CLIP',
  'TFLO',
  'GBIL',
]);

export function isCashEquivalent(holding: Holding): boolean {
  if (holding.assetType === 'option') return false;
  return holding.cashEquivalent === true
    || CASH_EQUIVALENT_SYMBOLS.has(holding.symbol.trim().toUpperCase());
}
