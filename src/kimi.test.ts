import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAiRuntimeConfig, normalizeOptionExpiration, parseOptionDetailImages, parsePortfolioImages } from './kimi';
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
    displayCurrency: 'USD',
    exposureTargetPct: 100,
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
    setTimeout: (handler: TimerHandler, timeout?: number) => setTimeout(handler, timeout),
    clearTimeout: (id: number) => clearTimeout(id),
  });
}

const importedPortfolio = JSON.stringify({
  holdings: [{
    symbol: 'AAPL',
    name: 'Apple',
    assetType: 'stock',
    shares: 1,
    buyPrice: 100,
    currentPrice: 120,
    marketValue: 120,
    sector: '科技',
    currency: 'USD',
    confidence: 'high',
    missingFields: [],
  }],
  cash: [],
  issues: [],
  sourceSummary: '已识别 1 个持仓',
});

function aiResponse(status: number, payload: object): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function successResponse(): Response {
  return aiResponse(200, { choices: [{ message: { content: importedPortfolio } }] });
}

function overloadedResponse(): Response {
  return aiResponse(503, { error: { code: 'service_unavailable', message: '当前访问量过大，请稍后再试' } });
}

function zhipuSettings(model = 'glm-4.6v-flash'): AppSettings {
  return settings({
    aiProvider: 'zhipu',
    zhipuApiKey: 'zhipu-test-key',
    zhipuModel: model,
  });
}

const screenshot = [{ dataUrl: 'data:image/png;base64,AA==', name: 'holding.png' }];

afterEach(() => {
  vi.useRealTimers();
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

describe('AI retry orchestration', () => {
  it('waits 30s and 65s for 429 responses, then succeeds on the third request', async () => {
    vi.useFakeTimers();
    setRuntimeConfig();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(aiResponse(429, { error: { code: '1302', message: '请求过于频繁' } }))
      .mockResolvedValueOnce(aiResponse(429, { error: { code: '1302', message: '请求过于频繁' } }))
      .mockResolvedValueOnce(successResponse());
    vi.stubGlobal('fetch', fetchMock);
    const onRetryWait = vi.fn();

    const resultPromise = parsePortfolioImages(zhipuSettings('glm-4v-flash'), screenshot, { onRetryWait });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.holdings[0]?.symbol).toBe('AAPL');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onRetryWait.mock.calls.map(([info]) => info.delayMs)).toEqual([30_000, 65_000]);
  });

  it('does not retry a network AbortError', async () => {
    vi.useFakeTimers();
    setRuntimeConfig();
    const fetchMock = vi.fn().mockRejectedValueOnce(new DOMException('timed out', 'AbortError'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(parsePortfolioImages(zhipuSettings(), screenshot)).rejects.toMatchObject({
      message: '网络请求失败：请求超过 180 秒',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to glm-4v-flash after zhipu overload retries are exhausted', async () => {
    vi.useFakeTimers();
    setRuntimeConfig();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(overloadedResponse())
      .mockResolvedValueOnce(overloadedResponse())
      .mockResolvedValueOnce(overloadedResponse())
      .mockResolvedValueOnce(successResponse());
    vi.stubGlobal('fetch', fetchMock);
    const onNotice = vi.fn();

    const resultPromise = parsePortfolioImages(zhipuSettings(), screenshot, { onNotice });
    await vi.runAllTimersAsync();
    await expect(resultPromise).resolves.toMatchObject({ sourceSummary: '已识别 1 个持仓' });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const lastBody = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body));
    expect(lastBody.model).toBe('glm-4v-flash');
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('已临时换用 glm-4v-flash'));
  });

  it('does not add a fallback request when the selected model is already glm-4v-flash', async () => {
    vi.useFakeTimers();
    setRuntimeConfig();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(overloadedResponse())
      .mockResolvedValueOnce(overloadedResponse())
      .mockResolvedValueOnce(overloadedResponse());
    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = parsePortfolioImages(zhipuSettings('glm-4v-flash'), screenshot);
    const rejection = expect(resultPromise).rejects.toMatchObject({ failureKind: 'overload' });
    await vi.runAllTimersAsync();
    await rejection;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('portfolio import normalization', () => {
  it('turns an option symbol like MSFU CALL into a valid ticker and option metadata', async () => {
    setRuntimeConfig();
    const content = JSON.stringify({
      holdings: [{
        symbol: ' MSFU CALL ', name: 'MSFU Call', assetType: 'option', shares: 1,
        buyPrice: 2, currentPrice: 3, currency: 'USD', sector: '未分类',
        option: { underlying: '', optionType: '', strike: 40, expiration: '2027-01-15', contractMultiplier: 100, delta: 0.5, underlyingPrice: 35 },
      }],
      cash: [], issues: [], sourceSummary: 'option',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(aiResponse(200, {
      choices: [{ message: { content } }],
    })));

    const result = await parsePortfolioImages(zhipuSettings('glm-4v-flash'), screenshot);

    expect(result.holdings[0]?.symbol).toBe('MSFU');
    expect(result.holdings[0]?.option?.underlying).toBe('MSFU');
    expect(result.holdings[0]?.option?.optionType).toBe('call');
  });

  it('normalizes a broker-reported -70 percent value to -0.7', async () => {
    setRuntimeConfig();
    const content = JSON.stringify({
      holdings: [{
        symbol: 'NVDA', name: 'NVIDIA', assetType: 'stock', shares: 1,
        buyPrice: 100, currentPrice: 30, marketValue: 30, costValue: 100,
        currency: 'USD', sector: '科技', reportedPnl: -70, reportedPnlPct: -70,
      }],
      cash: [], issues: [], sourceSummary: 'reported pnl',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(aiResponse(200, {
      choices: [{ message: { content } }],
    })));

    const result = await parsePortfolioImages(zhipuSettings('glm-4v-flash'), screenshot);

    expect(result.holdings[0]?.reportedPnl).toBe(-70);
    expect(result.holdings[0]?.reportedPnlPct).toBe(-0.7);
  });

  it('sends hardened symbol, lot-merging, and cash-ETF extraction rules', async () => {
    setRuntimeConfig();
    const fetchMock = vi.fn().mockResolvedValueOnce(successResponse());
    vi.stubGlobal('fetch', fetchMock);

    await parsePortfolioImages(zhipuSettings('glm-4v-flash'), screenshot);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const prompt = body.messages[1].content[0].text as string;
    expect(prompt).toContain('绝不能包含空格、CALL、PUT');
    expect(prompt).toContain('shares 相加、buyPrice 加权平均');
    expect(prompt).toContain('不要标成 stock');
  });
});

describe('option detail image parsing', () => {
  it.each([
    ['270115', '2027-01-15'],
    ['2027/01/15', '2027-01-15'],
    ["JAN 15 '27", '2027-01-15'],
  ])('normalizes broker expiration %s', (input, expected) => {
    expect(normalizeOptionExpiration(input)).toBe(expected);
  });

  it('extracts normalized option-only detail fields without creating stock holdings', async () => {
    setRuntimeConfig();
    const content = JSON.stringify({
      options: [{
        underlying: 'igv', optionType: 'CALL', strike: 80, expiration: '270115',
        contractMultiplier: 100, delta: 0.7921, theta: -0.0246, gamma: 0.0119,
        vega: 0.1908, impliedVolatility: 36.3, underlyingPrice: 93.76,
        premiumPrice: 18.3, contracts: 2, currency: 'USD',
      }],
      issues: [], sourceSummary: 'IGV option detail',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(aiResponse(200, {
      choices: [{ message: { content } }],
    })));

    const result = await parseOptionDetailImages(zhipuSettings('glm-4v-flash'), screenshot);

    expect(result.options).toEqual([expect.objectContaining({
      underlying: 'IGV', optionType: 'call', expiration: '2027-01-15',
      delta: 0.7921, impliedVolatility: 0.363, premiumPrice: 18.3, contracts: 2,
    })]);
    expect(result).not.toHaveProperty('holdings');
    expect(result).not.toHaveProperty('cash');
  });

  it('sends a dedicated option-detail prompt covering all broker date formats and Greeks', async () => {
    setRuntimeConfig();
    const content = JSON.stringify({ options: [], issues: [], sourceSummary: 'none' });
    const fetchMock = vi.fn().mockResolvedValueOnce(aiResponse(200, {
      choices: [{ message: { content } }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    await parseOptionDetailImages(zhipuSettings('glm-4v-flash'), screenshot);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const prompt = body.messages[1].content[0].text as string;
    expect(prompt).toContain('270115');
    expect(prompt).toContain('2027/01/15');
    expect(prompt).toContain("JAN 15 '27");
    expect(prompt).toContain('Delta、Theta、Gamma、Vega');
    expect(prompt).toContain('premiumPrice');
    expect(prompt).toContain('contracts');
    expect(prompt).toContain('不要输出股票持仓或现金');
  });
});
