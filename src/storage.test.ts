import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
});
