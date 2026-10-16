import { describe, expect, it } from 'vitest';
import { emptyInbox, ingestSignals, readInbox } from './signalInbox';
import type { QuantChannelAlert } from './types';
const alert = (z: number, date = '2026-09-15'): QuantChannelAlert => ({ available: true, z_score: z, as_of: date, complete_close: true, state: 'neutral', signal: 'neutral', label: '', reason: '', decision_use: false, buy_veto: false });
describe('signal entry inbox', () => {
  it('first encounter only establishes baseline and same data does not alert', () => {
    const result = ingestSignals(emptyInbox(), { AMZN: alert(-2) });
    expect(result.added).toEqual([]);
    expect(ingestSignals(result.inbox, { AMZN: alert(-2) }).added).toEqual([]);
    expect(ingestSignals(result.inbox, { AMZN: alert(-2, '2026-09-16') }).added).toEqual([]);
  });
  it('counts entrants even when exits leave the category total unchanged', () => {
    const base = ingestSignals(emptyInbox(), { A: alert(-2), B: alert(0), C: alert(0) }).inbox;
    const result = ingestSignals(base, { A: alert(0, '2026-09-16'), B: alert(-2, '2026-09-16'), C: alert(1.6, '2026-09-16') });
    expect(result.added.map(e => e.symbol)).toEqual(['B', 'C']);
    expect(result.inbox.unread.filter(e => e.category === 'buy')).toHaveLength(1);
  });
  it('persists read/seen state and excludes stale, partial, null, missing and backdated updates', () => {
    const base = ingestSignals(emptyInbox(), { A: alert(0) }).inbox;
    const entered = ingestSignals(base, { A: alert(1.4, '2026-09-16') }).inbox;
    const read = readInbox(JSON.stringify({ ...entered, unread: [] }));
    expect(ingestSignals(read, { A: alert(1.4, '2026-09-16') }).added).toEqual([]);
    for (const bad of [{ ...alert(2, '2026-09-17'), stale: true }, { ...alert(2, '2026-09-17'), complete_close: false }, { ...alert(2, '2026-09-17'), z_score: null }, alert(2, '2026-09-14')]) {
      expect(ingestSignals(read, { A: bad as QuantChannelAlert }).added).toEqual([]);
    }
    expect(ingestSignals(read, { NEW: alert(2, '2026-09-17') }).added).toEqual([]);
    expect(readInbox('corrupt')).toEqual(emptyInbox());
    expect(readInbox('{"version":1,"baseline":{"A":null},"seen":[],"unread":[]}')).toEqual(emptyInbox());
  });
  it('near-to-extreme is a new category, duplicate date corrections never replay', () => {
    const base = ingestSignals(emptyInbox(), { A: alert(-1.3) }).inbox;
    const result = ingestSignals(base, { A: alert(-1.6, '2026-09-16') });
    expect(result.added[0].category).toBe('buy');
    const corrected = ingestSignals(result.inbox, { A: alert(0, '2026-09-16') });
    expect(ingestSignals(corrected.inbox, { A: alert(-1.6, '2026-09-16') }).added).toEqual([]);
  });
});
