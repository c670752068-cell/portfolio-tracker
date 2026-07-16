import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AlertRule } from '../alertRules';
import type { QuantHoldingCost } from '../types';
import { AlertRulesPanel } from './AlertRulesPanel';

const noopCallbacks = {
  onCreate: vi.fn(),
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
};

function renderPanel(overrides: {
  rules?: AlertRule[];
  holdingCosts?: Record<string, QuantHoldingCost>;
  initialRuleType?: 'target_price' | 'gain_pct';
  initialSymbol?: string;
} = {}) {
  return renderToStaticMarkup(
    <AlertRulesPanel
      rules={overrides.rules ?? []}
      symbols={['FNGU', 'MSFT', 'SOXL']}
      holdingCosts={overrides.holdingCosts ?? {}}
      initialRuleType={overrides.initialRuleType}
      initialSymbol={overrides.initialSymbol}
      loading={false}
      error=""
      {...noopCallbacks}
    />,
  );
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

    expect(html).toContain('三券商加权成本');
    expect(html).toContain('value="22.5"');
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

    expect(html).toContain('部分账户参考成本');
    expect(html).toContain('19.8');
    expect(html).toContain('需要你核对或手动输入');
    expect(html).toContain('我已核对成本价');
    expect(html).not.toContain('value="19.8"');
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
        last_reminder_at: '2026-07-15 10:35 ET',
      }],
    });

    expect(html).toContain('FNGU');
    expect(html).toContain('当前价');
    expect(html).toContain('38');
    expect(html).toContain('距目标');
    expect(html).toContain('5.00%');
    expect(html).toContain('最近提醒');
    expect(html).toContain('2026-07-15 10:35 ET');
    expect(html).toContain('编辑');
    expect(html).toContain('删除');
    expect(html).toContain('只提醒不下单');
  });
});
