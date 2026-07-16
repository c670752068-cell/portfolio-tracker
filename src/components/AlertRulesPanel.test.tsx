import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AlertRule } from '../alertRules';
import type { Holding, QuantHoldingCost } from '../types';
import { AlertRulesPanel } from './AlertRulesPanel';

const noopCallbacks = {
  onCreate: vi.fn(),
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
};

function renderPanel(overrides: {
  rules?: AlertRule[];
  holdings?: Holding[];
  holdingCosts?: Record<string, QuantHoldingCost>;
  initialRuleType?: 'target_price' | 'gain_pct';
  initialSymbol?: string;
} = {}) {
  return renderToStaticMarkup(
    <AlertRulesPanel
      rules={overrides.rules ?? []}
      holdings={overrides.holdings ?? [holding('FNGU'), holding('MSFT'), holding('SOXL')]}
      holdingCosts={overrides.holdingCosts ?? {}}
      initialRuleType={overrides.initialRuleType}
      initialSymbol={overrides.initialSymbol}
      loading={false}
      error=""
      {...noopCallbacks}
    />,
  );
}

function holding(symbol: string, overrides: Partial<Holding> = {}): Holding {
  return {
    id: `${symbol}-${overrides.id || 'row'}`,
    symbol,
    name: symbol,
    shares: 10,
    buyPrice: 10,
    currentPrice: 20,
    sector: '科技',
    currency: 'USD',
    assetType: 'stock',
    source: 'quant-sync',
    broker: 'IBKR',
    ...overrides,
  };
}

describe('AlertRulesPanel forms', () => {
  it('renders target-price and gain-threshold rule choices with V7 defaults', () => {
    const targetHtml = renderPanel();
    const gainHtml = renderPanel({ initialRuleType: 'gain_pct', initialSymbol: 'MSFT' });

    expect(targetHtml).toContain('目标提醒');
    expect(targetHtml).toContain('目标价');
    expect(targetHtml).toContain('减到总仓位');
    expect(targetHtml).toContain('接近阈值');
    expect(targetHtml).toContain('5%');
    expect(targetHtml).toContain('3%');
    expect(gainHtml).toContain('成本价');
    expect(gainHtml).toContain('涨幅阈值');
    expect(gainHtml).toContain('+20%');
    expect(gainHtml).toContain('+30%');
    expect(gainHtml).toContain('卖出 50% 仓位，留 50% 博弈');
  });

  it('automatically fills a complete broker-weighted cost for a gain rule', () => {
    const html = renderPanel({
      initialRuleType: 'gain_pct',
      initialSymbol: 'SOXL',
      holdingCosts: {
        SOXL: {
          weighted_average_cost: 22.5,
          currency: 'USD',
          coverage: 'complete',
          auto_fill_allowed: true,
        },
      },
    });

    expect(html).toContain('$22.50（券商加权）');
    expect(html).toContain('已按股数加权');
    expect(html).not.toContain('value="22.5"');
    expect(html).not.toContain('需要你核对');
  });

  it('does not auto-fill a partial cost and requires explicit verification or manual entry', () => {
    const html = renderPanel({
      initialRuleType: 'gain_pct',
      initialSymbol: 'SOXL',
      holdingCosts: {
        SOXL: {
          weighted_average_cost: 19.8,
          currency: 'USD',
          coverage: 'partial',
          auto_fill_allowed: false,
        },
      },
    });

    expect(html).toContain('成本不可用');
    expect(html).toContain('19.8');
    expect(html).toContain('仅可用目标价规则');
    expect(html).not.toContain('手动输入');
    expect(html).not.toContain('我已核对');
  });

  it('locks the symbol to current holdings, deduplicates option underlyings, and filters cash equivalents', () => {
    const html = renderPanel({
      holdings: [
        holding('MSFU', { id: 'etf', assetType: 'leveraged_etf', broker: 'IBKR', marketValueOverride: 250 }),
        holding('MSFU', {
          id: 'call',
          assetType: 'option',
          broker: 'FUTU',
          marketValueOverride: 400,
          option: { underlying: 'MSFU', optionType: 'call', strike: 30, expiration: '2027-01-15', contractMultiplier: 100, delta: 0.4, theta: null, gamma: null, vega: null, impliedVolatility: null, underlyingPrice: 25 },
        }),
        holding('MSFT', { broker: 'LONGPORT', marketValueOverride: 500 }),
        holding('SGOV', { assetType: 'etf', cashEquivalent: true }),
      ],
      initialSymbol: 'MSFU',
    });

    expect(html).toContain('<select');
    expect(html).not.toContain('datalist');
    expect(html.match(/value="MSFU"/g)).toHaveLength(1);
    expect(html).toContain('MSFU · $650.00 · FUTU / IBKR');
    expect(html).toContain('MSFT · $500.00 · LONGPORT');
    expect(html).not.toContain('SGOV');
  });

  it('disables gain rules when the selected holding has no complete broker cost', () => {
    const html = renderPanel({ initialRuleType: 'target_price', initialSymbol: 'SOXL' });

    expect(html).toContain('<option value="gain_pct" disabled="">涨幅阈值（成本不可用）</option>');
  });
});

describe('AlertRulesPanel rule list', () => {
  it('shows current price, distance, last reminder, and edit/delete controls', () => {
    const html = renderPanel({
      rules: [{
        id: 'fngu-target',
        symbol: 'FNGU',
        type: 'target_price',
        direction: 'above',
        target_price: 40,
        approach_pct: 5,
        reduce_to_pct: 5,
        enabled: true,
        current_price: 38,
        distance_pct: 5,
        last_checked_at: '2026-07-15T15:10:00.000Z',
        last_reminder_at: '2026-07-15 10:35 ET',
      }],
    });

    expect(html).toContain('FNGU');
    expect(html).toContain('当前价');
    expect(html).toContain('38');
    expect(html).toContain('@ 11:10 ET');
    expect(html).toContain('还需上涨 5.00%');
    expect(html).toContain('最近提醒');
    expect(html).toContain('2026-07-15 10:35 ET');
    expect(html).toContain('编辑');
    expect(html).toContain('删除');
    expect(html).toContain('只提醒不下单');
  });
});
