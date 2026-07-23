import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyImageImport, applyOptionDetails } from './importMerge';
import type { ImportedPortfolio, ParsedOptionDetails, PortfolioState } from './types';

const SETTINGS_KEY = 'portfolio-tracker:settings-v1';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } satisfies Storage;
}

describe('display currency settings persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('defaults old settings without a display currency to USD', async () => {
    const { loadSettings } = await import('./storage');
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ aiProvider: 'zhipu' }));
    expect(loadSettings().displayCurrency).toBe('USD');
  });

  it('enables shared quant sync by default on a new phone or computer', async () => {
    const { loadSettings } = await import('./storage');
    expect(loadSettings().quantSyncEnabled).toBe(true);
    expect(loadSettings().quantSyncToken).toBe('');
  });

  it('persists a selected display currency', async () => {
    const { loadSettings, saveSettings } = await import('./storage');
    const settings = loadSettings();
    saveSettings({ ...settings, displayCurrency: 'CNY' });
    expect(loadSettings().displayCurrency).toBe('CNY');
  });

  it('defaults old settings without an exposure target to 100 percent', async () => {
    const { loadSettings } = await import('./storage');
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ aiProvider: 'zhipu' }));
    expect(loadSettings().exposureTargetPct).toBe(100);
  });

  it('falls back to 100 when the stored exposure target is outside 50–300', async () => {
    const { loadSettings } = await import('./storage');
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ exposureTargetPct: 500 }));
    expect(loadSettings().exposureTargetPct).toBe(100);
  });

  it('persists a valid exposure target across a reload', async () => {
    const { loadSettings, saveSettings } = await import('./storage');
    saveSettings({ ...loadSettings(), exposureTargetPct: 135 });
    expect(loadSettings().exposureTargetPct).toBe(135);
  });

  it('defaults the valuation anchor window, manual anchors, and distance thresholds', async () => {
    const { loadSettings } = await import('./storage');
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ aiProvider: 'zhipu' }));

    expect(loadSettings()).toMatchObject({
      valuationAnchorStart: '2025-04-01',
      valuationAnchorEnd: '2025-04-30',
      valuationManualAnchors: {},
      valuationAtAnchorPct: 5,
      valuationNearAnchorPct: 15,
    });
  });

  it('persists a manual NDX anchor and custom 3/10 thresholds', async () => {
    const { loadSettings, saveSettings } = await import('./storage');
    saveSettings({
      ...loadSettings(),
      valuationManualAnchors: { NDX: 21.6 },
      valuationAtAnchorPct: 3,
      valuationNearAnchorPct: 10,
    });

    expect(loadSettings()).toMatchObject({
      valuationManualAnchors: { NDX: 21.6 },
      valuationAtAnchorPct: 3,
      valuationNearAnchorPct: 10,
    });
  });
});

describe('portfolio import backup', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('restores the exact pre-import portfolio and clears the one-tap backup', async () => {
    const { backupPortfolio, clearPortfolioBackup, loadPortfolioBackup } = await import('./storage');
    const before: PortfolioState = {
      holdings: [{ id: 'msft', symbol: 'MSFT', name: 'Microsoft', shares: 10, buyPrice: 300, currentPrice: 400, sector: '科技', currency: 'USD' }],
      cash: [{ amount: 5000, currency: 'USD', source: 'manual' }],
      updatedAt: '2026-07-15T00:00:00.000Z',
    };
    const imported: ImportedPortfolio = {
      holdings: [{ symbol: 'IGV', name: 'IGV Call', shares: 2, buyPrice: 10, currentPrice: 18, sector: '期权', currency: 'USD', assetType: 'option', source: 'image-import' }],
      cash: [], issues: [], sourceSummary: 'option-only screenshot',
    };

    backupPortfolio(before);
    const afterImport = applyImageImport(before, imported, () => 'igv');
    expect(afterImport).not.toEqual(before);
    expect(loadPortfolioBackup()).toEqual(before);
    clearPortfolioBackup();
    expect(loadPortfolioBackup()).toBeNull();
  });

  it('restores the exact pre-import portfolio after option-details enrichment', async () => {
    const { backupPortfolio, clearPortfolioBackup, loadPortfolioBackup } = await import('./storage');
    const before: PortfolioState = {
      holdings: [
        { id: 'msft', symbol: 'MSFT', name: 'Microsoft', shares: 10, buyPrice: 300, currentPrice: 400, sector: '科技', currency: 'USD' },
        {
          id: 'igv', symbol: 'IGV', name: 'IGV CALL', shares: 2, buyPrice: 7, currentPrice: 18,
          sector: '科技', currency: 'USD', assetType: 'option',
          option: { underlying: 'IGV', optionType: 'call', strike: 80, expiration: null, contractMultiplier: 100, delta: null, theta: null, gamma: null, vega: null, impliedVolatility: null, underlyingPrice: null },
        },
      ],
      cash: [{ amount: 5000, currency: 'USD', source: 'manual' }],
      updatedAt: '2026-07-15T00:00:00.000Z',
    };
    const details: ParsedOptionDetails = {
      options: [{ underlying: 'IGV', optionType: 'call', strike: 80, expiration: '2027-01-15', contractMultiplier: 100, delta: 0.8, theta: -0.02, gamma: 0.01, vega: 0.18, impliedVolatility: 0.35, underlyingPrice: 95, premiumPrice: 18.3, contracts: 2, currency: 'USD' }],
      issues: [], sourceSummary: 'detail',
    };

    backupPortfolio(before);
    const enriched = applyOptionDetails(before, details, () => 'unused').next;
    expect(enriched).not.toEqual(before);
    expect(loadPortfolioBackup()).toEqual(before);
    clearPortfolioBackup();
    expect(loadPortfolioBackup()).toBeNull();
  });
});
