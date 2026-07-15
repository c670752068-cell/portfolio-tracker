import type { AiProvider } from './types';

interface RuntimeConfig {
  /** The self-hosted gateway origin. Leave blank for the GitHub Pages build. */
  apiBaseUrl?: string;
  deploymentLabel?: string;
}

declare global {
  interface Window {
    __PORTFOLIO_TRACKER_RUNTIME__?: RuntimeConfig;
  }
}

function runtimeApiBaseUrl(): string {
  const value = window.__PORTFOLIO_TRACKER_RUNTIME__?.apiBaseUrl?.trim();
  if (!value) return '';
  try {
    return new URL(value, window.location.origin).origin;
  } catch {
    return '';
  }
}

function apiUrl(path: string): string {
  const baseUrl = runtimeApiBaseUrl();
  return baseUrl ? new URL(path, `${baseUrl}/`).toString() : '';
}

export function getServerAiProxyUrl(provider: AiProvider): string {
  return apiUrl(`/api/${provider}/chat/completions`);
}

export function getServerQuoteProxyUrl(): string {
  return apiUrl('/api/quotes');
}

export function getServerPortfolioPositionsUrl(): string {
  return apiUrl('/api/portfolio/positions');
}

export function hasServerGateway(): boolean {
  return Boolean(runtimeApiBaseUrl());
}

export function serverGatewayLabel(): string {
  return window.__PORTFOLIO_TRACKER_RUNTIME__?.deploymentLabel?.trim() || '服务器转发';
}
