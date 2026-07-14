import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAiRuntimeConfig } from './kimi';
import type { AppSettings } from './types';

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    aiProvider: 'kimi',
    kimiApiKey: 'test-key',
    kimiModel: 'kimi-k2.6',
    proxyUrl: '',
    zhipuApiKey: '',
    zhipuModel: 'glm-4.6v-flash',
    zhipuProxyUrl: '',
    quoteProvider: 'none',
    quoteApiKey: '',
    quoteProxyUrl: '',
    autoRefreshQuotes: true,
    ...overrides,
  };
}

function setRuntimeConfig(apiBaseUrl?: string) {
  vi.stubGlobal('window', {
    location: {
      origin: 'http://67.215.255.196:8788',
      protocol: 'http:',
    },
    __PORTFOLIO_TRACKER_RUNTIME__: apiBaseUrl ? { apiBaseUrl } : {},
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getAiRuntimeConfig', () => {
  it('ignores an invalid custom proxy and falls back to the server gateway', () => {
    setRuntimeConfig('http://67.215.255.196:8788');

    const config = getAiRuntimeConfig(settings({ proxyUrl: 'sk-not-a-url' }));

    expect(config.endpoint).toBe('http://67.215.255.196:8788/api/kimi/chat/completions');
    expect(config.usesServerGateway).toBe(true);
  });

  it('falls back to the official endpoint when no server gateway exists', () => {
    setRuntimeConfig();

    const config = getAiRuntimeConfig(settings({ proxyUrl: 'api.moonshot.cn/v1' }));

    expect(config.endpoint).toBe('https://api.moonshot.cn/v1/chat/completions');
    expect(config.usesServerGateway).toBe(false);
  });
});
