import { describe, expect, it } from 'vitest';
import { quantSnapshotQuote } from './depthWindowPrice';
import { quantAnalysisFixture } from './testFixtures/quantAnalysis';
import type { QuantAnalysisSnapshot } from './types';

function snapshotWithAaplPrice(price: unknown, session?: unknown): QuantAnalysisSnapshot {
  const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
  const window = snapshot.symbols.AAPL.depth_window as unknown as Record<string, unknown>;
  window.current_price = price;
  if (session !== undefined) window.price_session = session;
  return snapshot;
}

describe('quantSnapshotQuote', () => {
  it('reads the price the quant snapshot already carries', () => {
    const quote = quantSnapshotQuote(snapshotWithAaplPrice(308.91), 'AAPL');

    expect(quote?.price).toBe(308.91);
    expect(quote?.source).toBe('quant');
    expect(quote?.symbol).toBe('AAPL');
  });

  it('matches the symbol case-insensitively', () => {
    expect(quantSnapshotQuote(snapshotWithAaplPrice(308.91), 'aapl')?.price).toBe(308.91);
  });

  it('keeps a valid price session and drops an unknown one', () => {
    expect(quantSnapshotQuote(snapshotWithAaplPrice(308.91, 'post'), 'AAPL')?.session).toBe('post');
    // The fixture ships 'afterhours', which is not in the PriceSession union.
    expect(quantSnapshotQuote(snapshotWithAaplPrice(308.91), 'AAPL')?.session).toBeUndefined();
  });

  it('returns null when the snapshot carries no usable price', () => {
    expect(quantSnapshotQuote(snapshotWithAaplPrice(undefined), 'AAPL')).toBeNull();
    expect(quantSnapshotQuote(snapshotWithAaplPrice(0), 'AAPL')).toBeNull();
    expect(quantSnapshotQuote(snapshotWithAaplPrice(null), 'AAPL')).toBeNull();
    expect(quantSnapshotQuote(snapshotWithAaplPrice(Number.NaN), 'AAPL')).toBeNull();
  });

  it('returns null for a symbol outside the snapshot', () => {
    expect(quantSnapshotQuote(snapshotWithAaplPrice(308.91), 'NFLX')).toBeNull();
  });

  it('returns null without a snapshot', () => {
    expect(quantSnapshotQuote(null, 'AAPL')).toBeNull();
  });
});
