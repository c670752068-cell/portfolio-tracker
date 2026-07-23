import { describe, expect, it } from 'vitest';
import { resolveValuationBasis } from './valuationBasis';

describe('resolveValuationBasis', () => {
  it('maps TQQQ to the NDX index anchor', () => {
    expect(resolveValuationBasis('TQQQ')).toEqual({
      kind: 'index_anchor',
      peSymbol: 'NDX',
      indexKey: 'NDX',
    });
  });

  it('maps stock-linked leverage to the underlying stock basis', () => {
    expect(resolveValuationBasis('TSLL')).toEqual({
      kind: 'stock_5y_mean',
      peSymbol: 'TSLA',
    });
  });

  it('uses an ordinary stock itself as its stock basis', () => {
    expect(resolveValuationBasis('goog')).toEqual({
      kind: 'stock_5y_mean',
      peSymbol: 'GOOG',
    });
  });

  it('excludes cash equivalents', () => {
    expect(resolveValuationBasis('SGOV')).toBeNull();
  });

  it('marks TECL as an approximate NDX index basis', () => {
    expect(resolveValuationBasis('TECL')).toEqual({
      kind: 'index_anchor',
      peSymbol: 'NDX',
      indexKey: 'NDX',
      approximate: true,
    });
  });
});
