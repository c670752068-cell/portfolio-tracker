import { isCashEquivalent } from './assetClass';
import { isRegularSession } from './marketSession';
import type { Holding, QuantHoldingCost } from './types';

export const ALERT_RULES_REFRESH_MS = 35 * 60 * 1000;

export type AlertRuleType = 'target_price' | 'gain_pct';
export type AlertDirection = 'above' | 'below';

export interface AlertHoldingOption {
  symbol: string;
  marketValue: number;
  brokers: string[];
  label: string;
}

export function buildAlertHoldingOptions(holdings: Holding[]): AlertHoldingOption[] {
  const grouped = new Map<string, { marketValue: number; brokers: Set<string> }>();
  for (const holding of holdings) {
    if (isCashEquivalent(holding)) continue;
    const symbol = (holding.assetType === 'option'
      ? holding.option?.underlying || holding.symbol
      : holding.symbol).trim().toUpperCase();
    if (!symbol) continue;
    const multiplier = holding.assetType === 'option' ? holding.option?.contractMultiplier ?? 100 : 1;
    const marketValue = holding.marketValueOverride
      ?? Math.abs(holding.shares) * holding.currentPrice * multiplier;
    const current = grouped.get(symbol) ?? { marketValue: 0, brokers: new Set<string>() };
    current.marketValue += Number.isFinite(marketValue) ? marketValue : 0;
    current.brokers.add(holding.broker?.trim().toUpperCase() || '手动');
    grouped.set(symbol, current);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([symbol, item]) => {
      const brokers = [...item.brokers].sort();
      return {
        symbol,
        marketValue: item.marketValue,
        brokers,
        label: `${symbol} · 市值 $${item.marketValue.toFixed(2)} · ${brokers.join(' / ')}`,
      };
    });
}

export interface AlertRuleDraft {
  id?: string;
  symbol: string;
  type: AlertRuleType;
  direction?: AlertDirection;
  target_price?: number;
  cost_basis?: number;
  gain_pct?: number;
  approach_pct: number;
  reduce_to_pct?: number;
  enabled: boolean;
}

export interface AlertRule extends AlertRuleDraft {
  id: string;
  current_price?: number | null;
  distance_pct?: number | null;
  last_reminder_at?: string | null;
  last_alert_type?: 'approach' | 'reached' | null;
  last_checked_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface AlertCallbacks {
  onCreate: (draft: AlertRuleDraft) => void | Promise<void>;
  onUpdate: (draft: AlertRuleDraft) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}

export type AlertRuleMutation =
  | { kind: 'create'; draft: AlertRuleDraft }
  | { kind: 'update'; draft: AlertRuleDraft & { id: string } }
  | { kind: 'delete'; id: string };

function targetPrice(rule: AlertRule): number | null {
  if (rule.type === 'target_price') return typeof rule.target_price === 'number' ? rule.target_price : null;
  if (typeof rule.cost_basis !== 'number' || typeof rule.gain_pct !== 'number') return null;
  return rule.cost_basis * (1 + rule.gain_pct / 100);
}

function formatNewYorkTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function formatAlertCurrentPrice(rule: AlertRule, now = new Date()): string {
  if (rule.current_price == null) return '当前价 待盘中检查';
  const label = isRegularSession(now) ? '当前价' : '上一交易日收盘';
  const checkedAt = formatNewYorkTime(rule.last_checked_at);
  return `${label} $${rule.current_price.toFixed(2)}${checkedAt ? ` @ ${checkedAt} ET` : ''}`;
}

export function formatAlertDistance(rule: AlertRule): string {
  if (rule.distance_pct == null) return '距目标 暂无';
  const direction = rule.type === 'gain_pct' ? 'above' : rule.direction ?? 'above';
  const target = targetPrice(rule);
  const reached = rule.current_price != null && target != null
    ? direction === 'above' ? rule.current_price >= target : rule.current_price <= target
    : rule.last_alert_type === 'reached';
  if (direction === 'above') {
    return `${reached ? '已高于目标' : '还需上涨'} ${rule.distance_pct.toFixed(2)}%`;
  }
  return `${reached ? '已低于目标' : '还需下跌'} ${rule.distance_pct.toFixed(2)}%`;
}

function normalizeRule(value: unknown): AlertRule {
  const raw = value as AlertRule & { last_alert_at?: string | null };
  const target = targetPrice(raw);
  const current = typeof raw.current_price === 'number' ? raw.current_price : null;
  const distance = typeof raw.distance_pct === 'number'
    ? raw.distance_pct
    : target && current !== null ? Math.abs(current - target) / target * 100 : null;
  return {
    ...raw,
    distance_pct: distance,
    last_reminder_at: raw.last_reminder_at ?? raw.last_alert_at ?? null,
  };
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: { message?: string } };
    return payload.error?.message || `提醒规则请求失败（HTTP ${response.status}）`;
  } catch {
    return `提醒规则请求失败（HTTP ${response.status}）`;
  }
}

export async function fetchAlertRules(endpoint: string): Promise<AlertRule[]> {
  const response = await fetch(endpoint, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(await errorMessage(response));
  const payload = await response.json() as { rules?: unknown[] };
  if (!Array.isArray(payload.rules)) throw new Error('服务器提醒规则格式无效');
  return payload.rules.map(normalizeRule);
}

export async function saveAlertRule(endpoint: string, draft: AlertRuleDraft): Promise<AlertRule> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  const payload = await response.json() as { rule?: unknown };
  if (!payload.rule) throw new Error('服务器未返回已保存规则');
  return normalizeRule(payload.rule);
}

export async function deleteAlertRule(endpoint: string, id: string): Promise<void> {
  const response = await fetch(`${endpoint}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(await errorMessage(response));
}

export function resolveHoldingCostSuggestion(cost: QuantHoldingCost | undefined) {
  const referenceValue = typeof cost?.weighted_average_cost === 'number' ? cost.weighted_average_cost : null;
  const automaticValue = cost?.coverage === 'complete' && cost.auto_fill_allowed ? referenceValue : null;
  return {
    automaticValue,
    referenceValue,
    requiresConfirmation: automaticValue === null,
    coverage: cost?.coverage ?? 'unavailable',
  } as const;
}

export async function dispatchAlertRuleMutation(action: AlertRuleMutation, callbacks: AlertCallbacks): Promise<void> {
  if (action.kind === 'create') await callbacks.onCreate(action.draft);
  else if (action.kind === 'update') await callbacks.onUpdate(action.draft);
  else await callbacks.onDelete(action.id);
}
