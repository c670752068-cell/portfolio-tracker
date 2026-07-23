import { CASH_EQUIVALENT_SYMBOLS } from './assetClass';
import { leverageInfoForSymbol } from './leverageMap';

export type BasisKind = 'stock_5y_mean' | 'index_anchor';

export interface ValuationBasis {
  kind: BasisKind;
  peSymbol: string;
  indexKey?: string;
  approximate?: boolean;
}

interface IndexBasisDefinition {
  indexKey: string;
  approximate?: boolean;
}

const INDEX_BASIS: Readonly<Record<string, IndexBasisDefinition>> = {
  QQQ: { indexKey: 'NDX' },
  TQQQ: { indexKey: 'NDX' },
  QLD: { indexKey: 'NDX' },
  SPY: { indexKey: 'SPX' },
  SPXL: { indexKey: 'SPX' },
  UPRO: { indexKey: 'SPX' },
  SSO: { indexKey: 'SPX' },
  DIA: { indexKey: 'DJI' },
  UDOW: { indexKey: 'DJI' },
  SMH: { indexKey: 'SOX' },
  SOXL: { indexKey: 'SOX' },
  TECL: { indexKey: 'NDX', approximate: true },
  IWM: { indexKey: 'RUT' },
  TNA: { indexKey: 'RUT' },
  FNGU: { indexKey: 'FANGPLUS' },
};

export function resolveValuationBasis(rawSymbol: string): ValuationBasis | null {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol || CASH_EQUIVALENT_SYMBOLS.has(symbol)) return null;

  const leverage = leverageInfoForSymbol(symbol);
  if (leverage?.underlying) {
    return {
      kind: 'stock_5y_mean',
      peSymbol: leverage.underlying,
    };
  }

  const index = INDEX_BASIS[symbol];
  if (index) {
    return {
      kind: 'index_anchor',
      peSymbol: index.indexKey,
      indexKey: index.indexKey,
      ...(index.approximate ? { approximate: true } : {}),
    };
  }

  return {
    kind: 'stock_5y_mean',
    peSymbol: symbol,
  };
}
