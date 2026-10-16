// 决策日志的类型与客户端。服务器端同一套字段在 deploy/decision-log.mjs。
export type DecisionTradeStatus = 'pending_note' | 'in_progress' | 'hit' | 'miss' | 'expired';
export type DecisionTrigger =
  | 'drawdown' | 'cnn' | 'vix' | 'pe_percentile' | 'z_score' | 'ma200' | 'sma'
  | 'sell_line' | 'take_profit' | 'subjective' | 'other';

export interface DecisionPrediction {
  type: 'rebuy_after_dip' | 'target_price' | 'beat_qqq' | 'take_profit_rule' | 'none';
  dip_pct?: number;
  target_price?: number;
  horizon_months?: number;
  trailing_pct?: number | null;
  fixed_gain_pct?: number | null;
  reference_symbol?: string | null;
}

export interface DecisionTradeIndicators {
  qqq_drawdown_pct: number | null;
  symbol_drawdown_pct: number | null;
  z_score: number | null;
  z_score_as_of: string | null;
  ma200_slope_pct: number | null;
  sma_slope_pct: number | null;
  ttm_pe: number | null;
  ttm_pe_percentile: number | null;
  cnn_fear_greed: number | null;
  vix: number | null;
  ndx_pe: number | null;
}

export interface DecisionTrade {
  id: string;
  trade_time: string;
  recorded_by: 'position_ledger' | 'manual';
  symbol: string;
  side: 'BUY' | 'SELL';
  asset_type: string | null;
  broker: string | null;
  qty: number;
  price: number | null;
  amount: number | null;
  price_source: string | null;
  price_estimated: boolean;
  indicators: DecisionTradeIndicators;
  trigger: DecisionTrigger[];
  prediction: DecisionPrediction | null;
  note: string;
  status: DecisionTradeStatus;
  resolved_at: string | null;
  resolved_price: number | null;
  result_pct: number | null;
  qqq_result_pct: number | null;
  vs_hold_pct: number | null;
}

export interface DecisionCashFlow { id: string; date: string; amount: number; note: string; created_at: string }
export interface DecisionNavPoint { date: string; nav: number; captured_at: string }

export interface DecisionLog {
  version: number;
  revision: number;
  updated_at: string | null;
  trades: DecisionTrade[];
  nav_series: DecisionNavPoint[];
  cash_flows: DecisionCashFlow[];
}

export interface DecisionTradeNote {
  trigger?: DecisionTrigger[];
  prediction?: DecisionPrediction | null;
  note?: string;
  price?: number;
}

export interface ManualTradeDraft {
  trade_time: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  price?: number;
}

const WRITE_HEADERS = { 'Content-Type': 'application/json', 'X-Decision-Log': '1' } as const;

class DecisionLogError extends Error {
  log?: DecisionLog;
  constructor(message: string, log?: DecisionLog) {
    super(message);
    this.log = log;
  }
}

async function unwrap(response: Response): Promise<DecisionLog> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message;
    throw new DecisionLogError(
      typeof message === 'string' ? message : `决策日志请求失败（HTTP ${response.status}）`,
      body?.log,
    );
  }
  return body.log as DecisionLog;
}

export async function fetchDecisionLog(endpoint: string, signal?: AbortSignal): Promise<DecisionLog> {
  return unwrap(await fetch(endpoint, { cache: 'no-store', signal }));
}

export async function saveTradeNote(
  endpoint: string, id: string, note: DecisionTradeNote, revision: number,
): Promise<DecisionLog> {
  return unwrap(await fetch(`${endpoint}/trades/${id}`, {
    method: 'PUT', headers: { ...WRITE_HEADERS }, body: JSON.stringify({ revision, ...note }),
  }));
}

export async function addManualTrade(
  endpoint: string, draft: ManualTradeDraft, revision: number,
): Promise<DecisionLog> {
  return unwrap(await fetch(`${endpoint}/trades`, {
    method: 'POST',
    headers: { ...WRITE_HEADERS },
    body: JSON.stringify({ revision, ...draft, symbol: draft.symbol.trim().toUpperCase() }),
  }));
}

export async function addCashFlow(
  endpoint: string, draft: { date: string; amount: number; note?: string }, revision: number,
): Promise<DecisionLog> {
  return unwrap(await fetch(`${endpoint}/cash-flows`, {
    method: 'POST', headers: { ...WRITE_HEADERS }, body: JSON.stringify({ revision, ...draft }),
  }));
}

export async function removeCashFlow(endpoint: string, id: string, revision: number): Promise<DecisionLog> {
  return unwrap(await fetch(`${endpoint}/cash-flows/${id}?revision=${revision}`, {
    method: 'DELETE', headers: { 'X-Decision-Log': '1' },
  }));
}
