export type Currency = 'USD' | 'CNY' | 'HKD' | 'OTHER';

export type DisplayCurrency = 'USD' | 'CNY' | 'HKD' | 'JPY' | 'EUR' | 'GBP';

export type AssetType = 'stock' | 'etf' | 'leveraged_etf' | 'option' | 'fund' | 'other';

export type QuoteProvider = 'none' | 'finnhub' | 'fmp' | 'alphavantage' | 'proxy';

export type QuoteSource = QuoteProvider | 'delta_estimate';

export type AiProvider = 'zhipu' | 'kimi';

export interface QuoteSnapshot {
  symbol: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  currency: Currency;
  timestamp: string | null;
  source: QuoteSource;
  isRealtime?: boolean;
  note?: string;
}

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
  source?: 'manual' | 'image-import' | 'quant-sync';
  broker?: string;
  cashEquivalent?: boolean;
  leverageFactor?: number;
  reportedPnl?: number | null;
  reportedPnlPct?: number | null;
  quote?: QuoteSnapshot;
}

export interface CashPosition {
  amount: number;
  currency: Currency;
  source?: 'manual' | 'image-import' | 'quant-sync';
  note?: string;
}

export interface PortfolioState {
  holdings: Holding[];
  cash: CashPosition[];
  updatedAt: string;
}

export interface AppSettings {
  aiProvider: AiProvider;
  kimiApiKey: string;
  kimiModel: string;
  proxyUrl: string;
  zhipuApiKey: string;
  zhipuModel: string;
  zhipuProxyUrl: string;
  quoteProvider: QuoteProvider;
  quoteApiKey: string;
  quoteProxyUrl: string;
  autoRefreshQuotes: boolean;
  displayCurrency: DisplayCurrency;
  exposureTargetPct: number;
  quantSyncEnabled: boolean;
  quantSyncToken: string;
}

export interface QuantPosition {
  broker: string;
  symbol: string;
  asset_type: 'stock' | 'etf' | 'option';
  qty: number;
  market_value: number;
}

export interface QuantPositionsPayload {
  as_of: string;
  currency: string;
  net_liquidation: number;
  broker: string;
  position_count_by_broker?: Record<string, number>;
  positions: QuantPosition[];
}

export interface QuantPositionsSnapshot {
  payload: QuantPositionsPayload;
  pushed_at: string;
  source: 'futu-assistant';
}

export interface QuantGateResult {
  passed: boolean;
  [key: string]: unknown;
}

export interface QuantSignalStatWindow {
  n: number;
  win_rate: number | null;
  sample_insufficient: boolean;
}

export interface QuantSignalStats {
  d5: QuantSignalStatWindow;
  d20: QuantSignalStatWindow;
  d60: QuantSignalStatWindow;
}

export interface QuantSymbolAnalysis {
  available: boolean;
  error?: string;
  gates?: Record<string, QuantGateResult>;
  gates_passed?: number;
  gates_total?: number;
  signal_stats?: Record<string, QuantSignalStats>;
  depth_stats?: {
    level_pct: number;
    win_rate_60d: number | null;
    n: number;
    sample_insufficient: boolean;
    bear_included: boolean;
  } | null;
}

export interface QuantHoldingCost {
  weighted_average_cost: number | null;
  currency: 'USD';
  coverage: 'complete' | 'partial' | 'unavailable';
  auto_fill_allowed: boolean;
}

export interface QuantSellBasis {
  observation: boolean;
}

export interface QuantSellFamily {
  family: string;
  market_value: number;
  held_symbols: readonly string[];
  repair: {
    status: string;
    base_date: string | null;
    window_open: boolean;
    priority: readonly string[];
    source?: string;
  };
  contentment: QuantSellBasis & {
    available: boolean;
    triggered: boolean;
    asset_gain_pct?: number;
    qqq_gain_pct?: number;
    gap_vs_qqq_pct?: number;
    signal?: string;
    minimum_reduction_pct?: number;
  };
  convergence: QuantSellBasis & {
    triggered: boolean;
    count: number;
    minimum_assets: number;
    symbols: readonly string[];
    action: string;
  };
  playbook: {
    available: boolean;
    label?: string;
    sell_steps: ReadonlyArray<{
      gain_min_pct: number;
      gain_max_pct: number;
      sell_position_pct: number;
    }>;
    risk_first_order: readonly string[];
  };
  recent_signals: ReadonlyArray<{ name: string; label: string; date: string }>;
}

export interface QuantSellSnapshot {
  shadow: boolean;
  symbols: Record<string, QuantSellFamily>;
}

export interface QuantAnalysisSnapshot {
  source: 'futu-assistant';
  generated_at: string;
  rule_version: string;
  disclaimer: string;
  context: Record<string, unknown>;
  symbols: Record<string, QuantSymbolAnalysis>;
  holding_costs?: Record<string, QuantHoldingCost>;
  sell?: QuantSellSnapshot;
}

/** Rates are quoted as "how many units of the currency equal one USD". */
export interface ExchangeRates {
  USD: number;
  CNY: number;
  HKD: number;
  JPY: number;
  EUR: number;
  GBP: number;
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
  dayChange: number;
  dayChangeNative: number;
  dayChangePct: number | null;
  weight: number;
  deltaEquivalentShares: number | null;
  deltaAdjustedExposure: number | null;
  equivalentExposure: number | null;
}

export interface PortfolioMetrics {
  totalValue: number;
  totalCost: number;
  knownCostSum: number;
  totalPnl: number;
  totalPnlPct: number;
  dayChange: number;
  dayChangePct: number;
  equityValue: number;
  cashValue: number;
  cashWeight: number;
  cashEquivalentValue: number;
  liquidityValue: number;
  liquidityWeight: number;
  holdingsMetrics: HoldingMetric[];
  sectorWeights: Record<string, number>;
  optionValue: number;
  optionWeight: number;
  deltaAdjustedExposure: number;
  equivalentExposureTotal: number;
  equivalentExposurePct: number;
  plainEquityExposure: number;
  leveragedEtfExposure: number;
  optionDeltaExposure: number;
  uncomputableOptions: number;
  underlyingExposure: Record<string, number>;
  unconvertedItems: string[];
  unknownCostItems: number;
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

export interface ParsedOptionDetail extends OptionDetails {
  premiumPrice: number | null;
  contracts: number | null;
  currency: Currency;
}

export interface ParsedOptionDetails {
  options: ParsedOptionDetail[];
  issues: ImportIssue[];
  sourceSummary: string;
}
