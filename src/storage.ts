import type { AppSettings, PortfolioState } from './types';

const PORTFOLIO_KEY = 'portfolio-tracker:portfolio-v1';
const SETTINGS_KEY = 'portfolio-tracker:settings-v1';

const emptyPortfolio: PortfolioState = {
  holdings: [],
  cash: [],
  updatedAt: new Date(0).toISOString(),
};

const defaultSettings: AppSettings = {
  kimiApiKey: '',
  kimiModel: 'kimi-k2.6',
  proxyUrl: '',
  quoteProvider: 'none',
  quoteApiKey: '',
  quoteProxyUrl: '',
  autoRefreshQuotes: true,
};

export function loadPortfolio(): PortfolioState {
  try {
    const raw = localStorage.getItem(PORTFOLIO_KEY);
    if (!raw) return emptyPortfolio;
    const parsed = JSON.parse(raw) as PortfolioState;
    return {
      holdings: Array.isArray(parsed.holdings) ? parsed.holdings : [],
      cash: Array.isArray(parsed.cash) ? parsed.cash : [],
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return emptyPortfolio;
  }
}

export function savePortfolio(state: PortfolioState): void {
  const next: PortfolioState = { ...state, updatedAt: new Date().toISOString() };
  localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(next));
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const oldTextOnlyModels = new Set(['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']);
    return {
      ...defaultSettings,
      ...parsed,
      // Existing users need a vision model for the new screenshot-import flow.
      kimiModel: oldTextOnlyModels.has(parsed.kimiModel ?? '') ? defaultSettings.kimiModel : parsed.kimiModel ?? defaultSettings.kimiModel,
    };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
