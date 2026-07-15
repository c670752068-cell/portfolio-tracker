import { describe, expect, it } from 'vitest';
import { applyImageImport, applyOptionDetails, countNeedsReview, crossCheckImportedPnl, mergeImportedHoldings } from './importMerge';
import type { Holding, ImportedPortfolio, ImportIssue, ParsedOptionDetails, PortfolioState } from './types';

type ImportedHolding = Omit<Holding, 'id'>;

function imported(overrides: Partial<ImportedHolding> = {}): ImportedHolding {
  return {
    symbol: 'NVDA', name: 'NVIDIA', shares: 10, buyPrice: 100, currentPrice: 110,
    sector: '科技', currency: 'USD', assetType: 'stock', source: 'image-import',
    marketValueOverride: 1100, costOverride: 1000, confidence: 'high', missingFields: [],
    ...overrides,
  };
}

describe('mergeImportedHoldings', () => {
  it('merges duplicate NVDA lots with summed shares and weighted buy price', () => {
    const merged = mergeImportedHoldings([
      imported(),
      imported({ shares: 5, buyPrice: 120, currentPrice: 115, marketValueOverride: 575, costOverride: 600, confidence: 'medium' }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.shares).toBe(15);
    expect(merged[0]?.buyPrice).toBeCloseTo(106.6666667);
    expect(merged[0]?.marketValueOverride).toBe(1675);
    expect(merged[0]?.costOverride).toBe(1600);
    expect(merged[0]?.currentPrice).toBe(110);
    expect(merged[0]?.confidence).toBe('medium');
  });

  it('keeps the merged cost override unknown when either lot lacks it', () => {
    const merged = mergeImportedHoldings([
      imported(),
      imported({ shares: 5, buyPrice: 0, costOverride: undefined }),
    ]);

    expect(merged[0]?.costOverride).toBeUndefined();
    expect(merged[0]?.buyPrice).toBe(100);
  });

  it('replaces the previous screenshot import while preserving manual entries', () => {
    const current: PortfolioState = {
      holdings: [
        { ...imported({ symbol: 'CASHX', source: 'manual' }), id: 'manual' },
        { ...imported({ symbol: 'OLD', source: 'image-import' }), id: 'old-import' },
      ],
      cash: [
        { amount: 10, currency: 'USD', source: 'manual' },
        { amount: 20, currency: 'USD', source: 'image-import' },
      ],
      updatedAt: '2026-07-14T00:00:00.000Z',
    };
    const result: ImportedPortfolio = {
      holdings: [imported({ symbol: 'NVDA', source: 'image-import' })],
      cash: [{ amount: 30, currency: 'USD', source: 'image-import' }],
      issues: [],
      sourceSummary: 'new import',
    };
    let id = 0;
    const createId = () => `new-${++id}`;

    const once = applyImageImport(current, result, createId);
    const twice = applyImageImport(once, result, createId);

    expect(twice.holdings.map((item) => item.symbol)).toEqual(['CASHX', 'NVDA']);
    expect(twice.cash.map((item) => item.amount)).toEqual([10, 30]);
  });
});

describe('crossCheckImportedPnl', () => {
  it('marks a holding and creates a required issue when computed and reported pnl signs differ', () => {
    const issues: ImportIssue[] = [];
    const checked = crossCheckImportedPnl(imported({
      shares: 10,
      buyPrice: 130,
      currentPrice: 100,
      marketValueOverride: 1000,
      costOverride: 1300,
      reportedPnl: 200,
    }), issues);

    expect(checked.confidence).toBe('low');
    expect(checked.missingFields).toContain('成本待核对');
    expect(issues).toEqual([expect.objectContaining({
      field: 'NVDA 成本待核对',
      priority: 'required',
    })]);
  });

  it('does not mark a difference below both the 10% and $50 thresholds', () => {
    const issues: ImportIssue[] = [];
    const checked = crossCheckImportedPnl(imported({
      shares: 4,
      buyPrice: 90,
      currentPrice: 100,
      marketValueOverride: 400,
      costOverride: 360,
      reportedPnl: 8,
    }), issues);

    expect(checked.confidence).toBe('high');
    expect(checked.missingFields).not.toContain('成本待核对');
    expect(issues).toEqual([]);
  });

  it('skips reconciliation when reported pnl is null', () => {
    const issues: ImportIssue[] = [];
    const original = imported({ reportedPnl: null });

    expect(crossCheckImportedPnl(original, issues)).toEqual(original);
    expect(issues).toEqual([]);
  });
});

describe('countNeedsReview', () => {
  it('counts each low-confidence or cost-check holding once', () => {
    const holdings: Holding[] = [
      { ...imported({ confidence: 'low' }), id: 'low' },
      { ...imported({ symbol: 'MSFT', missingFields: ['成本待核对'] }), id: 'cost' },
      { ...imported({ symbol: 'AAPL', confidence: 'low', missingFields: ['成本待核对'] }), id: 'both' },
      { ...imported({ symbol: 'META', confidence: 'high' }), id: 'ok' },
    ];

    expect(countNeedsReview(holdings)).toBe(3);
  });
});

function optionHolding(overrides: Partial<Holding> = {}): Holding {
  return {
    id: 'option-1', symbol: 'IGV', name: 'IGV CALL', shares: 2, buyPrice: 7.2,
    currentPrice: 18.41, sector: '科技', currency: 'USD', assetType: 'option',
    source: 'image-import', missingFields: ['Delta', '到期日'], confidence: 'medium',
    option: {
      underlying: 'IGV', optionType: 'call', strike: 80, expiration: null,
      contractMultiplier: 100, delta: null, theta: null, gamma: null, vega: null,
      impliedVolatility: null, underlyingPrice: null,
    },
    ...overrides,
  };
}

function optionDetails(overrides: Partial<ParsedOptionDetails['options'][number]> = {}): ParsedOptionDetails {
  return {
    options: [{
      underlying: 'IGV', optionType: 'call', strike: 80, expiration: '2027-01-15',
      contractMultiplier: 100, delta: 0.7921, theta: -0.0246, gamma: 0.0119,
      vega: 0.1908, impliedVolatility: 0.363, underlyingPrice: 93.76,
      premiumPrice: 18.3, contracts: 2, currency: 'USD', ...overrides,
    }],
    issues: [],
    sourceSummary: 'option detail',
  };
}

describe('applyOptionDetails', () => {
  it('updates the only matching option while preserving stocks and cash byte-for-byte', () => {
    const stock = { ...imported({ symbol: 'MSFT', name: 'Microsoft' }), id: 'stock-1' };
    const cash = { amount: 5675.01, currency: 'USD' as const, source: 'image-import' as const };
    const current: PortfolioState = {
      holdings: [stock, optionHolding()], cash: [cash], updatedAt: '2026-07-14T00:00:00.000Z',
    };

    const result = applyOptionDetails(current, optionDetails(), () => 'new-id');

    expect(result.next.holdings[0]).toEqual(stock);
    expect(result.next.holdings[0]).toBe(stock);
    expect(result.next.cash).toBe(current.cash);
    expect(result.next.cash).toEqual([cash]);
    expect(result.next.holdings[1]?.option).toEqual(expect.objectContaining({
      delta: 0.7921, expiration: '2027-01-15', underlyingPrice: 93.76,
    }));
    expect(result.next.holdings[1]?.currentPrice).toBe(18.3);
    expect(result.updated).toEqual(['IGV CALL']);
    expect(result.added).toEqual([]);
  });

  it('refuses an ambiguous same-underlying match when strike is missing', () => {
    const first = optionHolding({ id: 'igv-80' });
    const second = optionHolding({
      id: 'igv-90',
      name: 'IGV CALL 90',
      option: { ...optionHolding().option!, strike: 90 },
    });
    const current: PortfolioState = { holdings: [first, second], cash: [], updatedAt: 'old' };

    const result = applyOptionDetails(current, optionDetails({ strike: null }), () => 'new-id');

    expect(result.next.holdings).toEqual([first, second]);
    expect(result.updated).toEqual([]);
    expect(result.added).toEqual([]);
    expect(result.issues).toEqual([expect.objectContaining({ priority: 'required' })]);
  });

  it('adds an absent option without touching the existing portfolio', () => {
    const stock = { ...imported({ symbol: 'NVDA' }), id: 'stock' };
    const existingOption = optionHolding();
    const cash = [{ amount: 1000, currency: 'USD' as const, source: 'manual' as const }];
    const current: PortfolioState = { holdings: [stock, existingOption], cash, updatedAt: 'old' };

    const result = applyOptionDetails(current, optionDetails({
      underlying: 'NKE', strike: 55, expiration: '2027-01-15', delta: 0.248,
      theta: -0.012, gamma: 0.026, vega: 0.097, premiumPrice: 1.64, contracts: 2,
    }), () => 'nke-option');

    expect(result.next.holdings.slice(0, 2)).toEqual([stock, existingOption]);
    expect(result.next.holdings[2]).toEqual(expect.objectContaining({
      id: 'nke-option', symbol: 'NKE', shares: 2, currentPrice: 1.64,
      assetType: 'option', note: '由期权详情页新增',
    }));
    expect(result.next.holdings[2]?.option).toEqual(expect.objectContaining({ strike: 55, delta: 0.248 }));
    expect(result.next.cash).toBe(cash);
    expect(result.added).toEqual(['NKE CALL 55 2027-01-15']);
  });

  it('uses exact strike and expiration before the single-candidate fallback', () => {
    const target = optionHolding({
      id: 'target', name: 'IGV CALL 80 2027',
      option: { ...optionHolding().option!, expiration: '2027-01-15' },
    });
    const other = optionHolding({
      id: 'other', name: 'IGV CALL 90 2028',
      option: { ...optionHolding().option!, strike: 90, expiration: '2028-01-21' },
    });

    const result = applyOptionDetails(
      { holdings: [target, other], cash: [], updatedAt: 'old' },
      optionDetails(),
      () => 'new-id',
    );

    expect(result.next.holdings[0]?.option?.delta).toBe(0.7921);
    expect(result.next.holdings[1]).toBe(other);
    expect(result.updated).toEqual(['IGV CALL 80 2027']);
  });

  it('accident regression: enriching option details cannot delete or mutate any non-option holding or cash row', () => {
    const stock = { ...imported({ symbol: 'MSFT' }), id: 'msft' };
    const etf = { ...imported({ symbol: 'SGOV', assetType: 'etf', cashEquivalent: true }), id: 'sgov' };
    const cash = [
      { amount: 5675.01, currency: 'USD' as const, source: 'image-import' as const },
      { amount: 100, currency: 'CNY' as const, source: 'manual' as const },
    ];
    const current: PortfolioState = { holdings: [stock, etf, optionHolding()], cash, updatedAt: 'old' };

    const result = applyOptionDetails(current, optionDetails(), () => 'new-id');

    expect(result.next.holdings.filter((item) => item.assetType !== 'option')).toEqual([stock, etf]);
    expect(result.next.holdings[0]).toBe(stock);
    expect(result.next.holdings[1]).toBe(etf);
    expect(result.next.cash).toBe(cash);
    expect(result.next.cash).toEqual(cash);
  });
});
