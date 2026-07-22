import { describe, expect, it } from 'vitest';
import { quantAnalysisFixture } from './testFixtures/quantAnalysis';
import { findSellFamily, resolveSellStatus } from './sellStatus';
import type { QuantAnalysisSnapshot } from './types';

describe('resolveSellStatus', () => {
  it('downgrades a non-shadow signal while the whole sell module is in observation', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.summary!.sell_ready[0].shadow = false;

    expect(resolveSellStatus(snapshot, 'MSFT')).toEqual({
      state: 'observation',
      trigger: '知足常乐',
      detail: '自基准日 +18.00% vs QQQ +20.00%',
    });
  });

  it('keeps shadow sell evidence in observation instead of calling it an open window', () => {
    expect(resolveSellStatus(quantAnalysisFixture as QuantAnalysisSnapshot, 'MSFT')).toEqual({
      state: 'observation',
      trigger: '知足常乐',
      detail: '自基准日 +18.00% vs QQQ +20.00%',
    });
  });

  it('marks non-shadow sell evidence as an open window', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.sell!.shadow = false;
    snapshot.summary!.sell_ready[0].shadow = false;

    expect(resolveSellStatus(snapshot, 'MSFU')).toEqual({
      state: 'window_open',
      trigger: '知足常乐',
      detail: '自基准日 +18.00% vs QQQ +20.00%',
    });
  });

  it('returns none when the family has no sell evidence', () => {
    expect(resolveSellStatus(quantAnalysisFixture as QuantAnalysisSnapshot, 'SOXL')).toEqual({ state: 'none' });
  });
});

describe('findSellFamily', () => {
  it('prefers an exact family match over an earlier held-symbol match', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    const exact = structuredClone(snapshot.sell!.symbols.MSFT);
    const containing = { ...structuredClone(exact), family: 'OTHER', market_value: 99_000, held_symbols: ['X'] };
    snapshot.sell!.symbols = {
      OTHER: containing,
      X: { ...exact, family: 'X', market_value: 1_000, held_symbols: ['X'] },
    };

    expect(findSellFamily(snapshot, 'X')?.family.family).toBe('X');
  });

  it('uses the largest market-value family and reports ambiguity for multiple held-symbol matches', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    const base = structuredClone(snapshot.sell!.symbols.MSFT);
    snapshot.sell!.symbols = {
      SMALL: { ...structuredClone(base), family: 'SMALL', market_value: 1_000, held_symbols: ['SHARED'] },
      LARGE: { ...structuredClone(base), family: 'LARGE', market_value: 5_000, held_symbols: ['SHARED'] },
    };

    expect(findSellFamily(snapshot, 'SHARED')).toMatchObject({
      family: { family: 'LARGE' },
      matchType: 'held_symbol',
      multipleHeldMatches: true,
    });
  });
});
