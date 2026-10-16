import type { QuantChannelAlert } from './types';
import { zSignal } from './decisionSignals';

export const SIGNAL_INBOX_KEY = 'portfolio:closed-signal-inbox:v1';
export type EntryClass = 'buy' | 'buy_near' | 'sell' | 'sell_near';
export interface SignalEntry { id: string; symbol: string; date: string; category: EntryClass }
export interface SignalInbox {
  version: 1;
  baseline: Record<string, { date: string; state: string }>;
  seen: string[];
  unread: SignalEntry[];
}
export const emptyInbox = (): SignalInbox => ({ version: 1, baseline: {}, seen: [], unread: [] });
export function readInbox(raw: string | null): SignalInbox {
  try {
    const value = JSON.parse(raw || 'null');
    if (value?.version === 1 && value.baseline && typeof value.baseline === 'object'
      && Array.isArray(value.seen) && value.seen.every((v: unknown) => typeof v === 'string')
      && Array.isArray(value.unread) && value.unread.every((e: SignalEntry) => e && typeof e.id === 'string'
        && typeof e.symbol === 'string' && typeof e.date === 'string' && isEntryClass(e.category))
      && Object.values(value.baseline).every((v) => v && typeof v === 'object' && 'date' in v && typeof v.date === 'string' && 'state' in v && typeof v.state === 'string')) return value;
  } catch { /* Storage is optional and corrupt state establishes a new baseline. */ }
  return emptyInbox();
}
export function isEntryClass(value: string): value is EntryClass { return ['buy', 'buy_near', 'sell', 'sell_near'].includes(value); }

export function ingestSignals(current: SignalInbox, alerts: Record<string, QuantChannelAlert>) {
  const baseline = { ...current.baseline };
  const seen = new Set(current.seen);
  const added: SignalEntry[] = [];
  for (const [symbol, alert] of Object.entries(alerts)) {
    if (!alert.available || alert.stale || alert.complete_close !== true || !alert.as_of || typeof alert.z_score !== 'number' || !Number.isFinite(alert.z_score)) continue;
    const previous = baseline[symbol];
    if (previous && alert.as_of < previous.date) continue;
    const state = zSignal(alert.z_score);
    const id = `${symbol}:${alert.as_of}:${state}`;
    if (previous && alert.as_of > previous.date && state !== previous.state && isEntryClass(state) && !seen.has(id)) {
      added.push({ id, symbol, date: alert.as_of, category: state });
    }
    // First encounter is baseline only; same-date corrections never re-alert.
    baseline[symbol] = { date: alert.as_of, state };
    seen.add(id);
  }
  const unread = [...current.unread, ...added].filter(e => baseline[e.symbol]?.state === e.category).slice(-500);
  return { inbox: { version: 1 as const, baseline, seen: [...seen].slice(-5000), unread }, added };
}
