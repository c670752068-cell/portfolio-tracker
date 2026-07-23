import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, Holding, QuantHoldingCost } from '../types';
import { SettingsPanel } from './SettingsPanel';

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
    expect(html).toContain('MSFT · IBKR · coverage=partial');
    expect(html).toContain('量化系统对该标的的成本覆盖不完整');
    expect(html).toContain('AAPL · LONGPORT');
    expect(html).toContain('请在持仓表补填买入价');
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
