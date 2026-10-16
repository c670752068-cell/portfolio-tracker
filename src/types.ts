import type { PeHistoryPayload } from './peData';

export type Currency = 'USD' | 'CNY' | 'HKD' | 'OTHER';

export type DisplayCurrency = 'USD' | 'CNY' | 'HKD' | 'JPY' | 'EUR' | 'GBP';

export type ValuationIndexKey = 'NDX' | 'SOX' | 'SPX' | 'DJI' | 'FANGPLUS';

export type AssetType = 'stock' | 'etf' | 'leveraged_etf' | 'option' | 'fund' | 'other';

export type QuoteProvider = 'none' | 'finnhub' | 'fmp' | 'alphavantage' | 'proxy';

export type QuoteSource = QuoteProvider | 'delta_estimate' | 'quant';

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
  contractCode?: string;
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
  cost_basis?: number | null;
  contract_code?: string | null;
  option_type?: 'call' | 'put' | null;
  strike?: number | null;
  expiry?: string | null;
  contract_multiplier?: number | null;
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

export interface QuantDrawdownResearchHorizon {
  horizon_trading_days: number;
  n: number;
  pending_count: number;
  win_count: number;
  win_rate_pct: number | null;
  average_return_pct: number | null;
  median_return_pct: number | null;
  worst_return_pct: number | null;
  best_return_pct: number | null;
  sample_sufficient: boolean;
}

export interface QuantDrawdownResearch {
  symbol: string;
  basis_symbol: string;
  available_start: string;
  available_end: string;
  cycle_count: number;
  completed_cycle_count: number;
  ongoing_cycle_count: number;
  primary_horizon_days: number;
  minimum_comparison_samples: number;
  minimum_win_rate_pct: number;
  best_supported_depth_pct: number | null;
  most_observed_depth_pct: number;
  levels: Array<{
    depth_pct: number;
    horizons: Record<string, QuantDrawdownResearchHorizon>;
  }>;
}

export interface QuantHistoricalStandard {
  symbol?: string;
  basis_symbol?: string;
  lookback_years?: number;
  requested_start?: string;
  available_start?: string;
  available_end?: string;
  event_floor_pct?: number;
  completed_cycle_count?: number;
  ongoing_cycle_count?: number;
  sample_count: number;
  average_drawdown_pct: number | null;
  median_drawdown_pct: number | null;
  sample_status: 'direct' | 'reference' | 'insufficient';
  primary_statistic?: 'median';
  average_usage?: 'display_only';
  inherited?: boolean;
}

export interface QuantExecutionStandard {
  symbol?: string;
  basis_symbol: string;
  threshold_pct: number | null;
  source: string;
  sample_status?: 'direct' | 'reference' | 'insufficient';
  sample_count?: number;
  execution_allowed: boolean;
  requires_ma_confirmation?: boolean;
  forward_support_status?: 'supported' | 'reference' | 'insufficient';
}

export interface QuantMaSlopeSnapshot {
  symbol?: string;
  available: boolean;
  model: 'ma200_20d_annualized';
  role: 'trend_context_only';
  buy_veto: false;
  ma_period: 200;
  change_window_sessions: 20;
  annualization_sessions: 252;
  annualized_pct: number | null;
  current_ma: number | null;
  comparison_ma: number | null;
  direction: 'up' | 'down' | null;
  regime: 'strong_up' | 'weak_up' | 'weak_down' | 'strong_down' | null;
  label: string;
  as_of: string | null;
  price_adjustment: 'QFQ' | string;
  data_source: string;
  formula: string;
  reason: string;
  required_bars?: number;
  observed_bars?: number;
  error?: string;
  series?: ReadonlyArray<{
    date: string;
    annualized_pct: number;
  }>;
  decision_use?: false;
  query_source?: 'decision_snapshot' | 'custom' | 'custom_dashboard';
  dashboard?: QuantMaSlopeDashboard;
}

export type QuantMaSlopeDashboardRange = '1y' | '3y' | '5y' | '10y' | '20y';

export interface QuantMaSlopeDashboardPoint {
  date: string;
  is_partial?: boolean;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
  ma20?: number | null;
  ma50?: number | null;
  ma200?: number | null;
  slope20?: number | null;
  slope50?: number | null;
  slope200?: number | null;
  std200?: number | null;
  band200?: [number, number] | null;
  zscore200?: number | null;
}

export interface QuantMaSlopeTechnicalSummary {
  price: number;
  ma200: number | null;
  distance_to_ma200_pct: number | null;
  z_score: number | null;
  z_score_band: string | null;
  z_score_label: string;
  ma200_slope_annualized_pct: number | null;
  ma200_trend: 'strong_up' | 'weak_up' | 'weak_down' | 'strong_down' | null;
  ma200_trend_label: string;
}

export type QuantChannelAlertState = 'buy' | 'buy_near' | 'sell' | 'sell_near' | 'neutral' | 'insufficient';

export interface QuantChannelAlert {
  stale?: boolean;
  reviewed_at?: string;
  available: boolean;
  state: QuantChannelAlertState;
  signal: 'buy' | 'sell' | 'neutral';
  label: string;
  as_of: string | null;
  close?: number;
  lower_band?: number;
  upper_band?: number;
  z_score?: number;
  near_sigma?: number;
  boundary_sigma?: number;
  complete_close: true;
  decision_use: false;
  buy_veto: false;
  reason: string;
}

export interface QuantChannelReviewSnapshot {
  review_time: string;
  timezone: 'America/New_York';
  review_date: string | null;
  updated_at: string | null;
  symbols: Record<string, QuantChannelAlert>;
  failed_symbols?: string[];
  breakout_date?: string | null;
  breakouts?: Record<string, ZBreakoutStatus>;
  breakout_history?: ZBreakoutEvent[];
}

export interface ZBreakoutEvent {
  id: string; symbol: string; date: string; direction: 'up' | 'down';
  sessions: number; previous_z: number; z: number; confirmed: true;
}
export interface ZBreakoutStatus {
  status: 'triggered' | 'none' | 'unavailable' | 'insufficient';
  as_of: string; event: ZBreakoutEvent | null; reason: string;
}

export interface QuantMaSlopeDashboard {
  range: QuantMaSlopeDashboardRange;
  slope_window_sessions: number;
  slope_unit: 'pct_per_day';
  ma_periods: number[];
  band_sigma?: number;
  z_score_period?: number;
  latest_bar_status?: 'intraday' | 'closed';
  latest_closed_as_of?: string | null;
  channel_alert?: QuantChannelAlert | null;
  summary?: QuantMaSlopeTechnicalSummary | null;
  series: QuantMaSlopeDashboardPoint[];
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
    threshold_pct: number | null;
    current_price?: number | null;
    high_price?: number | null;
    high_price_date?: string | null;
    threshold_price?: number | null;
    next_level_price?: number | null;
    price_session: string;
    price_note?: string | null;
    win_rate_60d: number | null;
    n: number;
    sample_insufficient: boolean;
    bear_included: boolean;
    research?: QuantDrawdownResearch | null;
    historical_standard?: QuantHistoricalStandard | null;
    execution_standard?: QuantExecutionStandard | null;
  };
  historical_standard?: QuantHistoricalStandard | null;
  execution_standard?: QuantExecutionStandard | null;
  ma_slope?: QuantMaSlopeSnapshot | null;
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

export interface QuantSellPricePlan {
  available: boolean;
  method: 'forward_pe' | 'historical_cycle' | 'recovery_valuation' | 'benchmark_high' | 'ndx_valuation_stages' | 'unavailable';
  strategy_profile?: 'standard_stock' | 'high_growth_tolerant';
  action_stage_key?: 'reduce_risk' | 'clear_derivatives' | 'trim_stock' | string;
  basis_symbol: string | null;
  current_price: number | null;
  basis_current_price?: number | null;
  current_forward_pe: number | null;
  current_ttm_pe?: number | null;
  implied_forward_eps: number | null;
  sell_forward_pe: number | null;
  sell_price: number | null;
  trigger_price?: number | null;
  clear_forward_pe: number | null;
  clear_price: number | null;
  gap_pct: number | null;
  status: 'waiting' | 'reached' | 'unavailable';
  quality: 'current_estimate' | 'historical_reference' | 'reference_only' | 'unavailable';
  source: string | null;
  as_of: string | null;
  previous_high_price?: number | null;
  previous_high_date?: string | null;
  ttm_percentiles?: {
    median: number | null;
    p70: number | null;
    p80: number | null;
  };
  stages?: ReadonlyArray<{
    key: string;
    label: string;
    trigger_price: number | null;
    trigger_kind: string;
    prior_high_price?: number | null;
    ttm_valuation_price?: number | null;
    forward_valuation_price?: number | null;
    ttm_pe?: number | null;
    sell_holding_pct?: number | null;
    reached: boolean;
    action: string;
  }>;
  active_stage?: string | null;
  sample_count?: number;
  target_portfolio_weight_pct: number | null;
  note: string;
}

export interface QuantExitResearch {
  symbol: string;
  basis_symbol: string;
  available_start: string;
  available_end: string;
  sample_count: number;
  minimum_samples: number;
  sample_sufficient: boolean;
  method: string;
  retained_holding_pct: number;
  anchor: {
    low_date: string;
    low_price: number;
    current_price: number;
    current_gain_from_low_pct: number;
    highest_gain_from_low_pct: number;
  } | null;
  stages: ReadonlyArray<{
    key: string;
    label: string;
    quantile: number;
    target_gain_pct: number;
    historical_reach_pct: number;
    median_days_to_target: number | null;
    sell_holding_pct: number;
    target_price_from_latest_low: number | null;
    reached_now: boolean;
  }>;
}

export interface QuantSellFamily {
  family: string;
  market_value: number;
  held_symbols: readonly string[];
  positions?: ReadonlyArray<{
    symbol: string;
    asset_type: 'stock' | 'etf' | 'option';
    broker: string;
    quantity: number;
    contract_code?: string | null;
    contract_multiplier: number;
    current_price: number | null;
    price_session: string;
    price_note?: string | null;
    market_value: number;
    cost_basis: number | null;
    average_cost: number | null;
    unrealized_pnl_usd: number | null;
    unrealized_pnl_pct: number | null;
  }>;
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
  exit_research?: QuantExitResearch | null;
  sell_price_plan?: QuantSellPricePlan;
  recent_signals: ReadonlyArray<{ name: string; label: string; date: string }>;
  decision?: {
    verdict: 'SELL' | 'WAIT';
    label: '可以卖出' | '再等等';
    notification_state: 'sell' | 'near' | 'wait';
    reason: string;
    recommended_sell_pct: number;
    evidence: {
      profit: { status: string; pnl_pct: number | null; threshold_pct: number | null };
      history: {
        status: string;
        basis_symbol?: string | null;
        sample_count: number;
        current_gain_pct: number | null;
        target_gain_pct: number | null;
        gap_pct: number | null;
        historical_reach_pct: number | null;
        sell_holding_pct: number | null;
      };
      valuation: {
        status: string;
        percentile: number | null;
        source: string;
        current_pe?: number | null;
        average_pe?: number | null;
        as_of?: string | null;
      };
      sentiment: { status: string; score: number | null; rating?: string | null };
      relative_strength_hot: boolean;
      recent_signals: readonly string[];
    };
  };
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
    open: boolean | null;
    current_pct: number | null;
    threshold_pct: number | null;
    label: string;
    explanation: string;
  };
  /** Server-authored 1× benchmark gate. Extended prices are display-only. */
  entry_gate?: {
    available: boolean;
    passed: boolean | null;
    benchmark: string;
    price_basis: string;
    decision_close: number | null;
    high_close: number | null;
    drawdown: {
      current_pct: number | null;
      required_pct: number | null;
      passed: boolean | null;
    };
    moving_averages: ReadonlyArray<{
      period: number;
      value: number;
      touched: boolean;
      gap_pct: number;
    }>;
    ma_touch_passed: boolean | null;
    reference_price: number | null;
    reference_session: string | null;
    reason: string;
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
  ma_slope?: QuantMaSlopeSnapshot;
}

export interface QuantSellOpportunity {
  symbol: string;
  trigger: string;
  detail: string;
  shadow: boolean;
  recommended_sell_pct?: number;
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
  sell_near?: readonly QuantSellOpportunity[];
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
    stale?: boolean;
    stale_days?: number | null;
    gate_available?: boolean;
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

export interface QuantForwardPeEntry {
  current: number | null;
  percentile: number | null;
  percentile_unavailable_reason: string | null;
  series: readonly { date: string; value: number }[];
  series_start: string | null;
  series_end: string | null;
  constituents_used: number;
  constituents_excluded: number;
  weight_coverage_pct: number | null;
}

export interface QuantForwardPeHistory {
  generated_at: string;
  metric: 'forward_pe';
  frequency: 'daily';
  method: string;
  approximation_note: string;
  history_ready: boolean;
  history_days: number;
  history_days_required: number;
  symbols: Record<string, QuantForwardPeEntry>;
}

export type QuantStockForwardZone =
  | 'extreme_low'
  | 'low'
  | 'middle'
  | 'high'
  | 'ultra_high'
  | 'exempt';

export interface QuantStockForwardEntry {
  symbol: string;
  current: number | null;
  available: boolean;
  stale: boolean;
  as_of: string | null;
  source: string;
  unavailable_reason: string | null;
  zone: QuantStockForwardZone | null;
  label: string | null;
  icon: string | null;
  message: string | null;
  series: readonly { date: string; value: number }[];
  series_start: string | null;
  series_end: string | null;
}

export interface QuantStockForwardValuation {
  generated_at: string;
  metric: 'forward_pe_1bf';
  source: string;
  symbols_order: readonly string[];
  thresholds: {
    full_position_max: number;
    low_max: number;
    middle_max: number;
    high_max: number;
  };
  history_note: string;
  symbols: Record<string, QuantStockForwardEntry>;
}

export interface QuantIndexEtfValuationEntry {
  symbol: string;
  available: boolean;
  basis_symbol: string;
  basis_name: string;
  current_pe: number | null;
  forward_pe: number | null;
  as_of: string | null;
  source: string;
  source_url: string;
  fetched_at?: string;
  historical_available: boolean;
  history_note: string;
  forward_note?: string;
  metric_label?: string;
  stale?: boolean;
  refresh_error?: string;
}

export interface QuantIndexEtfValuation {
  generated_at: string;
  symbols: Record<string, QuantIndexEtfValuationEntry>;
}

export interface QuantBuyPlanCondition {
  key: 'ndx_pe_below' | 'cnn_score_below' | 'drawdown_below_pct' | 'vix_above' | 'vix_percentile_above';
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
  buy_sizing?: {
    suggested_usd: number | null;
    gate?: {
      passed: boolean;
      reason: string;
    };
    risk_context?: {
      total_effective_pct: number;
      total_cash_pct: number;
      sleeve: {
        name: string;
        effective_pct: number;
        cash_pct: number;
        unlimited?: boolean;
        hard_cap_pct: number | null;
        over_hard_cap_usd: number;
      };
    };
  };
}

export interface QuantBuyPlanStatus {
  evaluated_at: string;
  plans: readonly QuantBuyPlan[];
}

export interface QuantVixContext {
  available: boolean;
  reason?: string;
  value?: number | null;
  as_of?: string | null;
  percentile?: number | null;
  percentile_window_days?: number | null;
  zone?: 'extreme' | 'danger' | 'normal' | string;
  zone_label?: string;
  position_adjustment_pct?: number | null;
  policy?: 'adjustment_only' | string;
  is_proxy: boolean;
  source?: {
    provider?: string;
    kind?: string;
    is_proxy?: boolean;
  };
  term_structure?: {
    available: boolean;
    reason?: string;
  };
}

export interface QuantVixStudyStatistic {
  horizon_trading_days: number;
  n: number;
  win_rate_pct: number | null;
  observed_win_rate_pct: number | null;
  average_return_pct: number | null;
  median_return_pct: number | null;
  sample_sufficient: boolean;
  insufficient_reason: string | null;
}

export interface QuantVixPersistence {
  threshold: number;
  episode_count: number;
  median_trading_days: number | null;
  mean_trading_days: number | null;
  max_trading_days: number | null;
}

export interface QuantVixStudy {
  source: {
    provider: string;
    kind: string;
    is_proxy: boolean;
  };
  sample: {
    start: string;
    end: string;
    trading_days: number;
  };
  persistence: Record<string, QuantVixPersistence>;
  buckets: Record<string, Record<string, QuantVixStudyStatistic>>;
  fine_buckets: Record<string, Record<string, QuantVixStudyStatistic>>;
  by_regime: Record<string, Record<string, Record<string, QuantVixStudyStatistic>>>;
  regime_concentration: {
    bucket: string;
    horizon_trading_days: number;
    counts: Record<string, number>;
    top_regime: string;
    top_regime_share_pct: number;
    concentrated: boolean;
    warning: string | null;
  };
  headline: string;
  limitations: readonly string[];
  generated_at: string;
}

export interface QuantRegimeStatistic {
  horizon_trading_days: number;
  n: number;
  win_count?: number;
  pending_count?: number;
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
  bear_included?: boolean;
}

export interface QuantRegimeGridCell {
  row_bucket_index: number;
  col_bucket_index: number;
  row_bucket: string;
  col_bucket: string;
  n: number;
  observation_days?: number;
  episode_count?: number;
  bear_included: boolean;
  reference_benchmark: string;
  reference_horizon_days: number;
  reference: QuantRegimeStatistic | null;
  statistics?: Record<string, Record<string, QuantRegimeStatistic>>;
}

export interface QuantRegimeCurrentCell {
  row_index: number;
  col_index: number;
  row_label: string;
  col_label: string;
  row_value: number;
  col_value: number;
  row_basis: string;
  col_basis: string;
  as_of: string;
  price_session: string;
  n: number;
  observation_days?: number;
  episode_count?: number;
  bear_included: boolean;
  statistics: Record<string, Record<string, QuantRegimeStatistic>>;
}

export interface QuantRegimeVerdictCard {
  headline: string;
  cell_label: string;
  sample_sufficient: boolean;
  bear_included: boolean;
  sample_context: string;
  primary: { horizon_days: number | null; win_rate_pct: number | null; win_count?: number; pending_count?: number; median_return_pct: number | null; worst_return_pct: number | null; n: number | null };
  horizons: Record<string, { win_rate_pct: number | null; win_count?: number; pending_count?: number; median_return_pct: number | null; worst_return_pct: number | null; n: number } | null>;
  leveraged: { symbol: string; [horizon: string]: string | { win_rate_pct: number | null; win_count?: number; pending_count?: number; median_return_pct: number | null; worst_return_pct: number | null; n: number } | null };
  overlay_note: string;
  action_hint: string;
  caveats: readonly string[];
  plan_link: { ready_count: number; total_count: number; nearest: { label: string | null; missing: readonly string[] } | null };
}

export interface QuantRegimeStatus {
  available: boolean;
  reason?: string;
  evaluated_at?: string;
  headline?: string;
  axes?: {
    row: 'drawdown_from_high';
    column: 'vix_percentile_1y';
  };
  current?: {
    primary: {
      symbol: string;
      drawdown_pct: number;
      vix_value: number;
      vix_percentile_1y: number;
      vix_is_proxy: boolean;
      row_bucket_index: number;
      row_bucket: string;
      col_bucket_index: number;
      col_bucket: string;
      cell_label: string;
    };
    overlay: {
      overlay_available: boolean;
      participates_in_grid: false;
      pe: number | null;
      pe_percentile_5y: number | null;
      pe_zone: string | null;
      cnn_score: number | null;
      cnn_rating: string | null;
      overlay_note: string;
    };
    cell_stats: Record<string, Record<string, QuantRegimeStatistic>>;
  };
  current_cell?: QuantRegimeCurrentCell;
  verdict_card?: QuantRegimeVerdictCard;
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
    overlay_adjusted_target_pct: number;
    overlay_adjustment_pct: number;
    vix_adjusted_target_pct?: number;
    vix_adjustment_pct?: number;
    suggested_total_pct: number;
    basis?: 'matrix_only' | string;
    gap_pct: number;
    gap_usd: number;
    action_text: string;
    overlay_note: string | null;
    vix_note?: string | null;
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
    grid_sample_days: number;
    grid_start: string | null;
    grid_end: string | null;
    vix_observations: number;
    is_proxy: boolean;
    vix_source?: {
      provider: string;
      kind: string;
      is_proxy: boolean;
      usage_note?: string;
    };
    caveat: string;
    joint_span_days?: number;
    joint_span_start?: string | null;
    joint_span_end?: string | null;
    bear_sample_included?: boolean;
    conclusion_allowed?: boolean;
    insufficient_reason?: string | null;
    regime_bias?: string | null;
    qqq_span_return_pct?: number | null;
    qqq_span_max_drawdown_pct?: number | null;
    headline_caveat?: string | null;
  };
  legacy_pe_cnn_grid?: {
    deprecated: boolean;
    display: boolean;
    reason: string;
  };
}

export interface QuantAnalysisFreshness {
  positions_as_of: string | null;
  prices_at: string | null;
  price_session: string | null;
  valuation_as_of: string | null;
  /** Generation time of the historical statistics file, not this page refresh. */
  drawdown_generated_at?: string | null;
  cnn_as_of: string | null;
  regime_evaluated_at: string | null;
  sell_evaluated_at: string | null;
  buy_plan_evaluated_at: string | null;
  /** Backend-owned freshness summary for all verdict layers. */
  data_stale?: boolean;
  stale_days?: number;
  max_stale_days?: number;
  stale_sources?: string[];
  data_as_of?: string | null;
}

/**
 * Final verdicts are calculated once by the quant service.  The web client
 * deliberately only renders these fields; it must not rebuild the verdict
 * from individual gates.
 */
export interface QuantFinalVerdictLayer {
  layer: string;
  label?: string;
  state?: 'passed' | 'failed' | 'unknown' | 'not_applicable' | string;
  passed?: boolean | null;
  applicable?: boolean;
  reason?: string;
  benchmark?: string;
  gap_pp?: number;
  gap_pct?: number;
  trigger_price?: number;
  triggered_session?: string;
}

export interface QuantFinalVerdict {
  symbol: string;
  verdict: 'BUY' | 'NO_BUY' | 'UNDECIDABLE' | string;
  blocking_layers?: Array<{ layer: string; reason: string }>;
  passing_layers?: string[];
  unknown_layers?: string[];
  layers?: QuantFinalVerdictLayer[];
  single_sentence?: string;
  is_silence_by_rule?: boolean;
  data_as_of?: string | null;
  data_stale_days?: number;
  data_stale?: boolean;
}

export interface QuantFinalVerdictEnvelope {
  symbols: Record<string, QuantFinalVerdict>;
  data_stale?: boolean;
  stale_days?: number;
  data_as_of?: string | null;
}

/** Legacy direct-map payloads are accepted while older VPS snapshots expire. */
export type QuantFinalVerdictPayload = QuantFinalVerdictEnvelope | Record<string, QuantFinalVerdict>;

export interface QuantPortfolioRisk {
  ammo_overview?: {
    exposure?: { effective_usd?: number; effective_pct?: number };
    cash_exposure?: {
      invested_usd?: number;
      invested_pct?: number;
      available_usd?: number;
      basis?: string;
      denominator_usd?: number;
    };
    funding?: {
      available_usd?: number;
    };
    buying_power?: {
      by_underlying_usd?: number;
      by_2x_usd?: number;
      by_3x_usd?: number;
      binding_constraint?: string;
      headline?: string;
    };
    top_consumers?: Array<{ symbol: string; effective_usd: number; pct_of_nav: number }>;
  };
  max_loss?: { total_usd?: number; pct_of_nav?: number };
  option_exposure?: {
    premium_usd?: number;
    premium_pct_of_nav?: number;
    premium_cap_pct?: number;
    over_limit?: boolean;
    delta_exposure_usd?: number;
    delta_assumption?: string;
    delta_assumption_note?: string;
    items?: Array<{
      symbol: string;
      family?: string;
      contract_code?: string | null;
      option_type?: string | null;
      strike?: number | null;
      expiry?: string | null;
      option_price?: number | null;
      underlying_price?: number | null;
      contract_multiplier?: number | null;
      underlying_leverage?: number | null;
      delta?: number;
      delta_source?: string;
      delta_notional_usd?: number;
      data_quality?: string;
      days_to_expiry?: number | null;
      status?: string;
    }>;
  };
  sleeve_status?: Record<string, QuantSleeveStatus>;
  allocation_plan?: {
    total_available_usd?: number;
    by_sleeve?: Array<{
      sleeve: string;
      priority?: number;
      suggested_usd?: number;
      suggested_share_pct?: number;
      underweight_pp?: number;
      gap_usd?: number;
      blocked?: boolean;
      block_reason?: string;
      candidates?: Array<{ symbol: string }>;
    }>;
  };
  dip_status?: Record<string, { companion_text?: string; ammo?: { remaining_usd?: number; account_gate?: { allowed_usd?: number } } }>;
}

export interface QuantSleeveMetric {
  usd?: number;
  pct?: number;
  zone?: 'empty' | 'under' | 'on_target' | 'borrowing' | 'over_hard_cap' | string;
  over_baseline_usd?: number;
  over_hard_cap_usd?: number;
  gap_usd?: number;
  lent_pp?: number;
  available_target_pct?: number;
  basis?: 'effective' | 'cash' | string;
  denominator_usd?: number;
  deviation_pp?: number;
  underweight?: boolean;
  overweight?: boolean;
  block_new_buy?: boolean;
  /** A basis-specific explanation emitted by the quant service. */
  note?: string;
  borrowed_pp?: number;
}

export interface QuantSleeveStatus {
  unlimited?: boolean;
  baseline_pct?: number;
  hard_cap_pct?: number | null;
  borrowed_pp?: number;
  cash_borrowed_pp?: number;
  borrow_room_pp?: number;
  lent_pp?: number;
  available_target_pct?: number;
  block_new_buy?: boolean;
  note?: string;
  effective?: QuantSleeveMetric;
  cash?: QuantSleeveMetric;
  /** Backward-compatible fields from pre dual-metric exports. */
  pct?: number;
  target_pct?: number;
  deviation_pp?: number;
}

export interface QuantAnalysisSnapshot {
  source: 'futu-assistant';
  generated_at: string;
  rule_version: string;
  disclaimer: string;
  context: Record<string, unknown>;
  symbols: Record<string, QuantSymbolAnalysis>;
  growth_watchlist?: {
    generated_at?: string;
    source?: string;
    group_name?: string;
    names?: Record<string, string>;
    active_symbols: readonly string[];
    inherited?: ReadonlyArray<{ symbol: string; basis_symbol: string }>;
    excluded?: readonly string[];
    ignored?: readonly string[];
    unresolved?: ReadonlyArray<{
      symbol: string;
      name?: string;
      security_type?: string;
      reason?: string;
    }>;
    stale?: boolean;
  };
  holding_costs?: Record<string, QuantHoldingCost>;
  panic_window?: QuantPanicWindowSnapshot;
  review_checkpoint?: {
    label: string;
    at: string;
    checked_at: string;
    us_trading_day: string;
    notify: boolean;
    next_at: string;
    stale: boolean;
    notifications_sent: number;
    error?: string;
  };
  sell?: QuantSellSnapshot;
  summary?: QuantOpportunitySummary;
  pe_history?: PeHistoryPayload;
  pe_history_forward?: QuantForwardPeHistory;
  stock_forward_valuation?: QuantStockForwardValuation;
  index_etf_valuation?: QuantIndexEtfValuation;
  valuation_tab?: QuantValuationTab;
  buy_plan_status?: QuantBuyPlanStatus;
  regime_status?: QuantRegimeStatus;
  vix_study?: QuantVixStudy;
  today_verdict?: QuantTodayVerdict | null;
  behavior_mirror?: QuantBehaviorMirror | null;
  freshness?: QuantAnalysisFreshness;
  ammo_overview?: QuantPortfolioRisk['ammo_overview'];
  max_loss?: QuantPortfolioRisk['max_loss'];
  option_exposure?: QuantPortfolioRisk['option_exposure'];
  sleeve_status?: QuantPortfolioRisk['sleeve_status'];
  allocation_plan?: QuantPortfolioRisk['allocation_plan'];
  dip_status?: QuantPortfolioRisk['dip_status'];
  /** Server-owned exposure bands; the site must never invent these thresholds. */
  exposure_bands?: {
    basis?: string;
    effective_pct?: number;
    enforcement?: string;
    level?: 'safe' | 'caution' | 'warning' | 'danger' | string;
    thresholds?: { safe_max_pct?: number; caution_max_pct?: number; warning_max_pct?: number };
  };
  total_effective_delta_assumption?: { value?: number; message?: string };
  sleeve_denominators?: { cash?: string; effective?: string; note?: string };
  broker_health?: ReadonlyArray<{
    broker: string;
    as_of?: string | null;
    available?: boolean;
    error_code?: string | null;
  }>;
  option_expiry_watch?: ReadonlyArray<{
    symbol: string;
    family?: string;
    sleeve?: string;
    delta?: number;
    delta_source?: string;
    delta_notional_usd?: number;
    premium_usd?: number;
    moneyness?: string;
    days_to_expiry?: number | null;
    status?: string;
  }>;
  /** Dual-basis risk summary emitted by the backend. */
  total_effective_pct?: number;
  total_cash_pct?: number;
  invested_cash_total_usd?: number;
  cash_basis?: string;
  final_verdict?: QuantFinalVerdictPayload;
  /** The server-rendered daily statement, identical to the phone push (T4). */
  silence_broadcast?: QuantSilenceBroadcast;
}

/** One statement the backend renders once and both surfaces read verbatim. */
export interface QuantSilenceBroadcast {
  title?: string;
  body?: string;
  is_silence_by_rule?: boolean;
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
