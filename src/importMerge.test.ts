import { describe, expect, it } from 'vitest';
import { applyImageImport, countNeedsReview, crossCheckImportedPnl, mergeImportedHoldings } from './importMerge';
import type { Holding, ImportedPortfolio, ImportIssue, PortfolioState } from './types';

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
