import type { Holding } from './types';

export interface LeverageInfo {
  factor: number;
  underlying: string | null;
}

export const LEVERAGE_MAP: Readonly<Record<string, LeverageInfo>> = {
  TSLL: { factor: 2, underlying: 'TSLA' },
  MSFU: { factor: 2, underlying: 'MSFT' },
  NVDL: { factor: 2, underlying: 'NVDA' },
  TQQQ: { factor: 3, underlying: null },
  QLD: { factor: 2, underlying: null },
  SPXL: { factor: 3, underlying: null },
  UPRO: { factor: 3, underlying: null },
  SSO: { factor: 2, underlying: null },
  UDOW: { factor: 3, underlying: null },
  FNGU: { factor: 3, underlying: null },
  SOXL: { factor: 3, underlying: null },
  TECL: { factor: 3, underlying: null },
  TNA: { factor: 3, underlying: null },
  NVDU: { factor: 2, underlying: 'NVDA' },
  AAPU: { factor: 2, underlying: 'AAPL' },
};

export function leverageFactorFor(holding: Holding): number {
  if (holding.leverageFactor != null && holding.leverageFactor > 0) return holding.leverageFactor;
  const mapped = LEVERAGE_MAP[holding.symbol.trim().toUpperCase()];
  if (mapped) return mapped.factor;
  return holding.assetType === 'leveraged_etf' ? 2 : 1;
}

export function leverageUnderlyingFor(holding: Holding): string | null {
  return LEVERAGE_MAP[holding.symbol.trim().toUpperCase()]?.underlying ?? null;
}
