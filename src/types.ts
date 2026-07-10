export type Currency = 'USD' | 'CNY' | 'HKD' | 'OTHER';

export type AssetType = 'stock' | 'etf' | 'leveraged_etf' | 'option' | 'fund' | 'other';

export interface OptionDetails {
  underlying: string;
  optionType: 'call' | 'put';
  strike: number | null;
  expiration: string | null;
  contractMultiplier: number;
  delta: number | null;
  theta: number | null;
  gamma: number | null;
  vega: number | null;
  impliedVolatility: number | null;
  underlyingPrice: number | null;
}

export interface Holding {
  id: string;
  symbol: string;
  name: string;
  shares: number;
  buyPrice: number;
  currentPrice: number;
  sector: string;
  currency: Currency;
  note?: string;
  assetType?: AssetType;
  option?: OptionDetails;
  /** Screenshot imports can retain the broker-reported value even when a price is not visible. */
  marketValueOverride?: number;
  costOverride?: number;
  missingFields?: string[];
  confidence?: 'high' | 'medium' | 'low';
  source?: 'manual' | 'image-import';
}

export interface CashPosition {
  amount: number;
  currency: Currency;
  source?: 'manual' | 'image-import';
}

export interface PortfolioState {
  holdings: Holding[];
  cash: CashPosition[];
  updatedAt: string;
}

export interface AppSettings {
  kimiApiKey: string;
  kimiModel: string;
  proxyUrl: string;
}

/** Rates are quoted as "how many units of the currency equal one USD". */
export interface ExchangeRates {
  USD: number;
  CNY: number;
  HKD: number;
  updatedAt: string | null;
  source: 'live' | 'cache' | 'fallback';
}

export interface HoldingMetric {
  holding: Holding;
  marketValueNative: number;
  costNative: number;
  marketValue: number;
  cost: number;
  costKnown: boolean;
  pnl: number;
  pnlPct: number;
  weight: number;
  deltaEquivalentShares: number | null;
  deltaAdjustedExposure: number | null;
}

export interface PortfolioMetrics {
  totalValue: number;
  totalCost: number;
  totalPnl: number;
  totalPnlPct: number;
  equityValue: number;
  cashValue: number;
  cashWeight: number;
  holdingsMetrics: HoldingMetric[];
  sectorWeights: Record<string, number>;
  optionValue: number;
  optionWeight: number;
  deltaAdjustedExposure: number;
  underlyingExposure: Record<string, number>;
  unconvertedItems: string[];
  unknownCostItems: number;
}

export interface RiskFinding {
  level: 'info' | 'warn' | 'critical';
  title: string;
  detail: string;
}

export interface ImportIssue {
  field: string;
  reason: string;
  priority: 'required' | 'recommended';
}

export interface ImportedPortfolio {
  holdings: Omit<Holding, 'id'>[];
  cash: CashPosition[];
  issues: ImportIssue[];
  sourceSummary: string;
}
