import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyImageImport } from './importMerge';
import type { ImportedPortfolio, PortfolioState } from './types';

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
});
