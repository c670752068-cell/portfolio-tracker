import type { PeHistoryPayload } from './peData';

export type Currency = 'USD' | 'CNY' | 'HKD' | 'OTHER';

export type DisplayCurrency = 'USD' | 'CNY' | 'HKD' | 'JPY' | 'EUR' | 'GBP';

export type ValuationIndexKey = 'NDX' | 'SOX' | 'SPX' | 'DJI' | 'FANGPLUS';

export type AssetType = 'stock' | 'etf' | 'leveraged_etf' | 'option' | 'fund' | 'other';

export type QuoteProvider = 'none' | 'finnhub' | 'fmp' | 'alphavantage' | 'proxy';

export type QuoteSource = QuoteProvider | 'delta_estimate';

export type PriceSession = 'pre' | 'regular' | 'post' | 'overnight' | 'closed';

export type AiProvider = 'zhipu' | 'kimi';

export interface QuoteSnapshot {
  symbol: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  currency: Currency;
  timestamp: string | null;
  session?: PriceSession;
  priceTime?: string | null;
  regularMarketPrice?: number | null;
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
  peApiKey: string;
  quoteProxyUrl: string;
  autoRefreshQuotes: boolean;
  displayCurrency: DisplayCurrency;
  exposureTargetPct: number;
  quantSyncEnabled: boolean;
  quantSyncToken: string;
  valuationAnchorStart: string;
  valuationAnchorEnd: string;
  valuationManualAnchors: Partial<Record<ValuationIndexKey, number>>;
  valuationAtAnchorPct: number;
  valuationNearAnchorPct: number;
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
  depth_window?: {
    applicable: boolean;
    open: boolean;
    current_pct: number;
    threshold_pct: number;
    current_price?: number | null;
    high_price?: number | null;
    threshold_price?: number | null;
    next_level_price?: number | null;
    price_session: string;
    price_note?: string | null;
    win_rate_60d: number | null;
    n: number;
    sample_insufficient: boolean;
    bear_included: boolean;
  };
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
  profit_gate?: {
    available: boolean;
    market_value: number;
    cost: number | null;
    unrealized_pnl_usd: number | null;
    unrealized_pnl_pct: number | null;
    in_profit: boolean | null;
    min_ladder_gain_pct: number;
    reaches_first_ladder: boolean;
    verdict: 'hold_loss' | 'hold_below_ladder' | 'ladder_active';
    verdict_text: string;
  };
  repair: {
    status: string;
    base_date: string | null;
    window_open: boolean;
    actionable?: boolean;
    display_text?: string;
    priority: readonly string[];
    source?: string;
  };
  contentment: QuantSellBasis & {
    available: boolean;
    triggered: boolean;
    actionable?: boolean;
    asset_gain_pct?: number;
    qqq_gain_pct?: number;
    gap_vs_qqq_pct?: number;
    signal?: string;
    minimum_reduction_pct?: number;
  };
  convergence: QuantSellBasis & {
    triggered: boolean;
    actionable?: boolean;
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

export interface QuantPanicSymbolStatus {
  applicable: boolean;
  state: string;
  state_label: string;
  stop_reason: string | null;
  depth: {
    open: boolean;
    current_pct: number;
    threshold_pct: number;
    label: string;
    explanation: string;
  };
  panic: {
    open: boolean;
    threshold_pct: number;
    label: string;
    explanation: string;
    triggered_session: string | null;
    triggered_at: string | null;
  };
  target: {
    target_pct: number;
    current_pct: number;
    progress_pct: number;
    label: string;
  };
  display: {
    title: string;
    state_label: string;
    depth_open_text: string;
    panic_open_text: string;
    progress_text: string;
  };
}

export interface QuantPanicWindowSnapshot {
  applicable: boolean;
  state: string;
  state_label: string;
  stop_reason: string | null;
  current_family_pct: number;
  generated_at: string;
  symbols: Record<string, QuantPanicSymbolStatus>;
}

export interface QuantBuyOpportunity {
  symbol: string;
  kind: string;
  reason: string;
  drawdown_pct: number;
  threshold_pct: number;
  win_rate_60d: number | null;
  n: number;
  sample_insufficient: boolean;
  price_session: string | null;
  panic_session: string | null;
  excess_pct?: number;
  gap_pct?: number;
}

export interface QuantSellOpportunity {
  symbol: string;
  trigger: string;
  detail: string;
  shadow: boolean;
}

export interface QuantDepthPresentation {
  status: 'ready' | 'near' | 'far';
  gap_pct: number;
  excess_pct: number;
  progress_pct: number;
}

export interface QuantOpportunitySummary {
  buy_ready: readonly QuantBuyOpportunity[];
  buy_near: readonly QuantBuyOpportunity[];
  sell_ready: readonly QuantSellOpportunity[];
  idle_symbols: readonly string[];
  idle_count: number;
  depth_states: Record<string, QuantDepthPresentation>;
  generated_at: string;
}

export type QuantVerdictLevel = 'block' | 'buy' | 'trim' | 'wait' | 'hold';

export interface QuantTodayVerdict {
  as_of: string;
  headline: string;
  level: QuantVerdictLevel;
  points: readonly string[];
  rule_version: string;
}

export interface QuantBehaviorStatistic {
  n: number;
  sample_sufficient: boolean;
}

export interface QuantBehaviorMirror {
  trades_analyzed: number;
  sell_flycount: QuantBehaviorStatistic & {
    flew_pct: number;
    avg_missed_60d_pct: number;
  };
  chase_high: QuantBehaviorStatistic & {
    chased_pct: number;
    avg_entry_drawdown_pct: number;
  };
  weakness_labels: readonly string[];
  streak_days_following_rules: number;
}

export interface QuantValuationHistoryPoint {
  date: string;
  pe: number | null;
  pb: number | null;
}

export interface QuantCnnHistoryPoint {
  date: string;
  score: number | null;
}

export interface QuantValuationAnchor {
  label: string;
  date?: string;
  ndx_pe?: number;
  cnn_score?: number;
  value_pe?: number;
}

export interface QuantValuationDistance {
  label: string;
  target_pe: number;
  current_pe: number;
  pe_gap_pct: number;
  implied_qqq_price: number | null;
  current_qqq_price: number | null;
  price_gap_pct: number | null;
  estimate_note: string;
}

export interface QuantValuationTab {
  available: boolean;
  reason?: string;
  generated_at: string;
  ndx: {
    available: boolean;
    current_pe: number | null;
    current_pb: number | null;
    pe_percentile_5y: number | null;
    zone: string | null;
    percentile_lines: {
      p30: number | null;
      median: number | null;
      p70: number | null;
    };
    history: readonly QuantValuationHistoryPoint[];
    source: string;
    as_of: string | null;
    realtime_estimate: {
      pe: number;
      basis: string;
      qqq_price: number;
      daily_qqq_close: number;
      price_session: string;
      estimated_at: string;
      note: string;
    } | null;
  };
  cnn: {
    available: boolean;
    current_score: number | null;
    rating: string | null;
    history: readonly QuantCnnHistoryPoint[];
    source: string;
    as_of: string | null;
  };
  anchors: readonly QuantValuationAnchor[];
  distance_to_anchors: readonly QuantValuationDistance[];
}

export interface QuantBuyPlanCondition {
  key: 'ndx_pe_below' | 'cnn_score_below' | 'drawdown_below_pct';
  name: string;
  target: number | null;
  current: number | null;
  met: boolean;
  gap_text: string;
}

export interface QuantBuyPlan {
  id: string;
  symbol: string;
  label: string;
  enabled: boolean;
  ready: boolean;
  conditions_ready: boolean;
  conditions: readonly QuantBuyPlanCondition[];
  met_count: number;
  total_count: number;
  action_text: string;
  action_amount_usd: number | null;
  buy_pct_of_nav: number;
  position_gate: {
    passed: boolean;
    note: string;
  };
}

export interface QuantBuyPlanStatus {
  evaluated_at: string;
  plans: readonly QuantBuyPlan[];
}

export interface QuantRegimeStatistic {
  horizon_trading_days: number;
  n: number;
  win_rate_pct: number | null;
  mean_return_pct: number | null;
  median_return_pct: number | null;
  worst_return_pct: number | null;
  sample_sufficient: boolean;
  sample_warning: string | null;
  insufficient_reason?: string | null;
  horizon_conflict?: boolean;
  horizon_conflict_gap_pct?: number | null;
  horizon_conflict_note?: string | null;
}

export interface QuantRegimeGridCell {
  pe_bucket_index: number;
  cnn_bucket_index: number;
  pe_bucket: string;
  cnn_bucket: string;
  n: number;
  reference_benchmark: string;
  reference_horizon_days: number;
  reference: QuantRegimeStatistic | null;
}

export interface QuantRegimeStatus {
  available: boolean;
  reason?: string;
  evaluated_at?: string;
  current?: {
    pe: number;
    pe_percentile_5y: number;
    pe_bucket_index: number;
    pe_bucket: string;
    cnn_score: number;
    cnn_bucket_index: number;
    cnn_bucket: string;
    regime_label: string;
  };
  grid?: readonly (readonly QuantRegimeGridCell[])[];
  divergence?: {
    detected: boolean;
    direction: 'cnn_too_high' | 'cnn_too_low' | null;
    expected_cnn_median: number | null;
    cnn_q1: number | null;
    cnn_q3: number | null;
    cnn_iqr: number | null;
    actual_cnn: number;
    note: string;
    historical_occurrences: number;
    no_reference?: boolean;
    reference_note?: string | null;
    sample_sufficient: boolean;
    sample_warning: string | null;
    win_rates: Record<string, Record<string, QuantRegimeStatistic>>;
  };
  win_rates?: Record<string, Record<string, QuantRegimeStatistic>>;
  position_advice?: {
    current_risk_position_pct: number;
    matrix_target_pct: number;
    divergence_adjusted_target_pct: number;
    suggested_total_pct: number;
    basis?: 'matrix_only' | string;
    gap_pct: number;
    gap_usd: number;
    action_text: string;
    divergence_note: string | null;
    capped_by_max_step: boolean;
    max_step_pct: number;
    position_gate: {
      passed: boolean;
      note: string;
      evidence?: Record<string, boolean>;
    };
    scope_note: string;
    disclaimer: string;
  };
  data_quality?: {
    joint_sample_days: number;
    joint_start: string | null;
    joint_end: string | null;
    raw_pe_observations: number;
    raw_cnn_observations: number;
    pe_interpolated: boolean;
    cnn_history_span: string;
    caveat: string;
    joint_span_days?: number;
    bear_sample_included?: boolean;
    conclusion_allowed?: boolean;
    insufficient_reason?: string | null;
    regime_bias?: string | null;
    qqq_span_return_pct?: number | null;
    qqq_span_max_drawdown_pct?: number | null;
    headline_caveat?: string | null;
  };
}

export interface QuantAnalysisFreshness {
  positions_as_of: string | null;
  prices_at: string | null;
  price_session: string | null;
  valuation_as_of: string | null;
  cnn_as_of: string | null;
  regime_evaluated_at: string | null;
  sell_evaluated_at: string | null;
  buy_plan_evaluated_at: string | null;
}

export interface QuantAnalysisSnapshot {
  source: 'futu-assistant';
  generated_at: string;
  rule_version: string;
  disclaimer: string;
  context: Record<string, unknown>;
  symbols: Record<string, QuantSymbolAnalysis>;
  holding_costs?: Record<string, QuantHoldingCost>;
  panic_window?: QuantPanicWindowSnapshot;
  sell?: QuantSellSnapshot;
  summary?: QuantOpportunitySummary;
  pe_history?: PeHistoryPayload;
  valuation_tab?: QuantValuationTab;
  buy_plan_status?: QuantBuyPlanStatus;
  regime_status?: QuantRegimeStatus;
  today_verdict?: QuantTodayVerdict | null;
  behavior_mirror?: QuantBehaviorMirror | null;
  freshness?: QuantAnalysisFreshness;
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
