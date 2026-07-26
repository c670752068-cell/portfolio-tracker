import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { QuantAnalysisSnapshot } from '../types';
import { DecisionStatusBar } from './DecisionStatusBar';

describe('DecisionStatusBar', () => {
  it('counts only backend buy-ready rows and profit-gated ladder-active sell families', () => {
    const snapshot = {
      source: 'futu-assistant',
      generated_at: '2026-07-26T11:49:37-04:00',
      rule_version: '2.2',
      disclaimer: 'display only',
      context: {},
      symbols: {},
      summary: {
        buy_ready: [{ symbol: 'TQQQ' }, { symbol: 'SOXL' }],
        buy_near: [],
        sell_ready: [],
        idle_symbols: [],
        idle_count: 0,
        depth_states: {},
        generated_at: '2026-07-26T11:49:37-04:00',
      },
      sell: {
        shadow: false,
        symbols: {
          GDX: { profit_gate: { verdict: 'hold_loss' } },
          FNGU: { profit_gate: { verdict: 'hold_below_ladder' } },
          MSFT: { profit_gate: { verdict: 'ladder_active' } },
        },
      },
      freshness: {
        positions_as_of: '2026-07-23',
        prices_at: '2026-07-26T11:49:37-04:00',
        price_session: 'regular',
        valuation_as_of: '2026-07-24',
        cnn_as_of: '2026-07-24',
        regime_evaluated_at: '2026-07-26T11:49:37-04:00',
        sell_evaluated_at: '2026-07-26T11:49:37-04:00',
        buy_plan_evaluated_at: '2026-07-26T11:49:37-04:00',
      },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(<DecisionStatusBar snapshot={snapshot} />);

    expect(html).toContain('当前 2 个标的达到买入条件');
    expect(html).toContain('1 个持仓达到止盈档');
    expect(html).toContain('持仓 2026-07-23');
    expect(html).toContain('价格 2026-07-26');
  });

  it('uses calm neutral copy when both backend counts are zero', () => {
    const snapshot = {
      source: 'futu-assistant',
      generated_at: '2026-07-26T11:49:37-04:00',
      rule_version: '2.2',
      disclaimer: 'display only',
      context: {},
      symbols: {},
      summary: {
        buy_ready: [],
        buy_near: [],
        sell_ready: [],
        idle_symbols: [],
        idle_count: 0,
        depth_states: {},
        generated_at: '2026-07-26T11:49:37-04:00',
      },
      sell: { shadow: true, symbols: {} },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(<DecisionStatusBar snapshot={snapshot} />);
    expect(html).toContain('当前没有标的达到买入条件');
    expect(html).toContain('当前没有持仓达到止盈档');
  });
});
