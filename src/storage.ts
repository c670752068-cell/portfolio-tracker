import type { AppSettings, DisplayCurrency, PortfolioState } from './types';
import { sanitizeEndpointUrl } from './endpointUrl';
import { getServerQuoteProxyUrl } from './runtimeConfig';

const PORTFOLIO_KEY = 'portfolio-tracker:portfolio-v1';
const SETTINGS_KEY = 'portfolio-tracker:settings-v1';
const BACKUP_KEY = 'portfolio-tracker:portfolio-backup-v1';

const emptyPortfolio: PortfolioState = {
  holdings: [],
  cash: [],
  updatedAt: new Date(0).toISOString(),
};

function buildDefaultSettings(): AppSettings {
  const quoteProxyUrl = getServerQuoteProxyUrl();
  return {
  aiProvider: 'zhipu',
  kimiApiKey: '',
  kimiModel: 'kimi-k2.6',
  proxyUrl: '',
  zhipuApiKey: '',
  zhipuModel: 'glm-4.6v-flash',
  zhipuProxyUrl: '',
  quoteProvider: quoteProxyUrl ? 'proxy' : 'none',
  quoteApiKey: '',
  peApiKey: '',
  quoteProxyUrl,
  autoRefreshQuotes: true,
  displayCurrency: 'USD',
  exposureTargetPct: 100,
  quantSyncEnabled: true,
  quantSyncToken: '',
  };
}

const defaultSettings = buildDefaultSettings();

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

export function backupPortfolio(state: PortfolioState): void {
  localStorage.setItem(BACKUP_KEY, JSON.stringify(state));
}

export function loadPortfolioBackup(): PortfolioState | null {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PortfolioState;
    if (!Array.isArray(parsed.holdings) || !Array.isArray(parsed.cash)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPortfolioBackup(): void {
  localStorage.removeItem(BACKUP_KEY);
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
      aiProvider: parsed.aiProvider === 'kimi' || parsed.aiProvider === 'zhipu' ? parsed.aiProvider : defaultSettings.aiProvider,
      zhipuModel: parsed.zhipuModel ?? defaultSettings.zhipuModel,
      proxyUrl: sanitizeEndpointUrl(parsed.proxyUrl ?? defaultSettings.proxyUrl),
      zhipuProxyUrl: sanitizeEndpointUrl(parsed.zhipuProxyUrl ?? defaultSettings.zhipuProxyUrl),
      // A server deployment provides its own same-origin quotes endpoint. Existing
      // browser data is never overwritten when the user already chose a provider.
      quoteProvider: parsed.quoteProvider ?? defaultSettings.quoteProvider,
      peApiKey: parsed.peApiKey ?? defaultSettings.peApiKey,
      quoteProxyUrl: sanitizeEndpointUrl(parsed.quoteProxyUrl ?? defaultSettings.quoteProxyUrl),
      displayCurrency: isDisplayCurrency(parsed.displayCurrency) ? parsed.displayCurrency : defaultSettings.displayCurrency,
      exposureTargetPct: isValidExposureTarget(parsed.exposureTargetPct) ? parsed.exposureTargetPct : 100,
    };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function isDisplayCurrency(value: unknown): value is DisplayCurrency {
  return ['USD', 'CNY', 'HKD', 'JPY', 'EUR', 'GBP'].includes(String(value));
}

function isValidExposureTarget(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 50 && value <= 300;
}
