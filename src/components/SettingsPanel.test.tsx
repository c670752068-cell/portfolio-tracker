import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, Holding, QuantHoldingCost } from '../types';
import { SettingsPanel, SettingsSaveBar } from './SettingsPanel';

beforeEach(() => vi.stubGlobal('window', {}));
afterEach(() => vi.unstubAllGlobals());

const settings: AppSettings = {
  aiProvider: 'zhipu', kimiApiKey: '', kimiModel: 'kimi-k2.6', proxyUrl: '',
  zhipuApiKey: '', zhipuModel: 'glm-4.6v-flash', zhipuProxyUrl: '',
  quoteProvider: 'none', quoteApiKey: '', quoteProxyUrl: '', autoRefreshQuotes: false,
  displayCurrency: 'USD', exposureTargetPct: 100, quantSyncEnabled: true, quantSyncToken: '',
  peApiKey: '',
  valuationAnchorStart: '2025-04-01', valuationAnchorEnd: '2025-04-30',
  valuationManualAnchors: {}, valuationAtAnchorPct: 5, valuationNearAnchorPct: 15,
};

function holding(overrides: Partial<Holding>): Holding {
  return {
    id: 'holding', symbol: 'MSFT', name: 'Microsoft', shares: 1,
    buyPrice: 0, currentPrice: 100, sector: '科技', currency: 'USD',
    assetType: 'stock', broker: 'IBKR', ...overrides,
  };
}

describe('SettingsPanel cost coverage', () => {
  it('renders a sticky save bar only for dirty settings', () => {
    const html = renderToStaticMarkup(
      <SettingsSaveBar dirtyCount={2} onSave={() => undefined} />,
    );

    expect(html).toContain('sticky');
    expect(html).toContain('bottom-0');
    expect(html).toContain('2 项未保存');
  });

  it('uses an h2 section title followed only by non-skipping card headings', () => {
    const html = renderToStaticMarkup(
      <SettingsPanel settings={settings} onSave={() => undefined} />,
    );
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));

    expect(levels[0]).toBe(2);
    expect(levels.every((level, index) => index === 0 || level <= levels[index - 1] + 1)).toBe(true);
  });

  it('mentions the configured server gateway label only once in its status sentence', () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://67.215.255.196:8788' },
      __PORTFOLIO_TRACKER_RUNTIME__: {
        apiBaseUrl: 'http://67.215.255.196:8788',
        deploymentLabel: '美国 VPS 中转',
      },
    });
    const html = renderToStaticMarkup(
      <SettingsPanel settings={settings} onSave={() => undefined} />,
    );

    expect(html.match(/美国 VPS 中转/g)).toHaveLength(1);
  });

  it('uses neutral product copy for the backup AI provider', () => {
    const html = renderToStaticMarkup(
      <SettingsPanel settings={settings} onSave={() => undefined} />,
    );

    expect(html).toContain('默认使用智谱（更稳定）。Kimi 作为备用，网络不佳时可能超时。');
    expect(html).not.toContain('你手机上的 Kimi');
  });

  it('groups the effective-exposure numerator before dividing by total assets', () => {
    const html = renderToStaticMarkup(
      <SettingsPanel settings={settings} onSave={() => undefined} />,
    );

    expect(html).toContain('等效仓位 =（正股 + 杠杆 ETF × 倍数 + 期权 Delta 折算）÷ 总资产');
  });

  it('separates the two Chinese anchor-policy thoughts without a sentence-leading space', () => {
    const html = renderToStaticMarkup(
      <SettingsPanel settings={settings} onSave={() => undefined} />,
    );

    expect(html).not.toContain('基准。 手动锚点');
    expect(html).toMatch(/基准。<\/p><p[^>]*>手动锚点/);
  });

  it('annotates every visual-model option with a distinct structured tradeoff', () => {
    const html = renderToStaticMarkup(
      <SettingsPanel settings={settings} onSave={() => undefined} />,
    );

    expect(html).toContain('glm-4.6v-flash（免费/快）');
    expect(html).toContain('glm-4v-flash（免费/轻量）');
    expect(html).toContain('glm-5v-turbo（更强/更贵）');
    expect(html).toContain('glm-4.6v（更强/免费额度低）');
    expect(html).toContain('glm-4.1v-thinking-flash（思维链/最慢）');
  });

  it('keeps infrastructure URLs inside a collapsed troubleshooting disclosure', () => {
    vi.stubGlobal('window', {
      location: { origin: 'http://67.215.255.196:8788' },
      __PORTFOLIO_TRACKER_RUNTIME__: {
        apiBaseUrl: 'http://67.215.255.196:8788',
        deploymentLabel: '美国 VPS 中转',
      },
    });
    const html = renderToStaticMarkup(
      <SettingsPanel settings={settings} onSave={() => undefined} />,
    );

    expect(html).toContain('已自动使用服务器转发');
    expect(html).toMatch(/<details[^>]*>.*完整转发地址.*http:\/\/67\.215\.255\.196:8788\/api\/zhipu\/chat\/completions.*<\/details>/);
  });

  it('offers an independent locally stored Alpha Vantage PE key', () => {
    const html = renderToStaticMarkup(
      <SettingsPanel settings={{ ...settings, peApiKey: 'demo-pe' }} onSave={() => undefined} />,
    );

    expect(html).toContain('Alpha Vantage PE API Key');
    expect(html).toContain('type="password"');
    expect(html).toContain('value="demo-pe"');
  });

  it('renders configurable valuation anchor dates, manual indices, and thresholds', () => {
    const html = renderToStaticMarkup(
      <SettingsPanel settings={settings} onSave={() => undefined} />,
    );

    expect(html).toContain('估值基准');
    expect(html).toContain('value="2025-04-01"');
    expect(html).toContain('value="2025-04-30"');
    expect(html).toContain('NDX 手动锚点');
    expect(html).toContain('FANGPLUS 手动锚点');
    expect(html).toContain('已进入锚点区阈值');
    expect(html).toContain('接近锚点阈值');
    expect(html).toContain('锚点 = 2025 年 4 月关税冲击期间的最低 PE。当前不使用更深的历史/熊市极值作为基准。');
  });

  it('groups all three cost-gap reasons and shows an actionable instruction for each', () => {
    const holdings = [
      holding({ id: 'option', symbol: 'NVDA', assetType: 'option', broker: 'FUTU' }),
      holding({ id: 'quant', symbol: 'MSFT', broker: 'IBKR' }),
      holding({ id: 'manual', symbol: 'AAPL', broker: 'LONGPORT' }),
    ];
    const holdingCosts: Record<string, QuantHoldingCost> = {
      MSFT: { weighted_average_cost: 300, currency: 'USD', coverage: 'partial', auto_fill_allowed: false },
      AAPL: { weighted_average_cost: null, currency: 'USD', coverage: 'complete', auto_fill_allowed: true },
    };
    const html = renderToStaticMarkup(
      <SettingsPanel settings={settings} holdings={holdings} holdingCosts={holdingCosts} onSave={() => undefined} />,
    );

    expect(html).toContain('成本数据覆盖');
    expect(html).toContain('已有成本 0 / 共 3 个持仓');
    expect(html).toContain('NVDA · FUTU');
    expect(html).toContain('期权成本量化系统未提供，请在「持仓 → 补充期权详情」上传期权详情页截图');
    expect(html).toContain('MSFT · IBKR · 成本不完整');
    expect(html).toContain('量化系统对该标的的成本覆盖不完整');
    expect(html).toContain('AAPL · LONGPORT');
    expect(html).toContain('请在持仓表补填买入价');
  });

  it('translates cost coverage machine codes for display', () => {
    const holdings = [holding({ id: 'quant', symbol: 'MSFT', broker: 'IBKR' })];
    const holdingCosts: Record<string, QuantHoldingCost> = {
      MSFT: { weighted_average_cost: 300, currency: 'USD', coverage: 'partial', auto_fill_allowed: false },
    };
    const html = renderToStaticMarkup(
      <SettingsPanel settings={settings} holdings={holdings} holdingCosts={holdingCosts} onSave={() => undefined} />,
    );

    expect(html).toContain('MSFT · IBKR · 成本不完整');
    expect(html).not.toContain('coverage=');
  });

  it('separates equity and option cost gaps and lists each symbol-broker only once', () => {
    const holdings = [
      holding({ id: 'equity', symbol: 'MSFT', assetType: 'stock', broker: 'IBKR' }),
      holding({ id: 'option', symbol: 'MSFU', assetType: 'option', broker: 'FUTU' }),
      holding({ id: 'duplicate', symbol: 'MSFU', assetType: 'stock', broker: 'FUTU' }),
    ];
    const holdingCosts: Record<string, QuantHoldingCost> = {
      MSFU: { weighted_average_cost: null, currency: 'USD', coverage: 'unavailable', auto_fill_allowed: false },
    };
    const html = renderToStaticMarkup(
      <SettingsPanel settings={settings} holdings={holdings} holdingCosts={holdingCosts} onSave={() => undefined} />,
    );

    expect(html).toContain('正股及 ETF 成本无来源');
    expect(html).toContain('MSFT · IBKR');
    expect(html).toContain('期权成本无量化来源');
    expect(html.match(/MSFU · FUTU/g)).toHaveLength(1);
  });

  it('reports that every holding has cost data when coverage is complete', () => {
    const holdings = [
      holding({ id: 'stock', symbol: 'MSFT' }),
      holding({ id: 'option', symbol: 'NVDA', assetType: 'option', costOverride: 2_000 }),
    ];
    const holdingCosts: Record<string, QuantHoldingCost> = {
      MSFT: { weighted_average_cost: 300, currency: 'USD', coverage: 'complete', auto_fill_allowed: true },
    };
    const html = renderToStaticMarkup(
      <SettingsPanel settings={settings} holdings={holdings} holdingCosts={holdingCosts} onSave={() => undefined} />,
    );

    expect(html).toContain('已有成本 2 / 共 2 个持仓');
    expect(html).toContain('全部持仓成本齐全');
  });
});
