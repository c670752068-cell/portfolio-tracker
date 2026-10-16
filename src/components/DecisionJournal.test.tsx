import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DecisionJournalView } from './DecisionJournal';
import type { DecisionLog, DecisionTrade } from '../decisionLog';
import type { ExchangeRates } from '../types';

const rates: ExchangeRates = { USD: 1, CNY: 7, HKD: 7.8, JPY: 155, EUR: 0.92, GBP: 0.79, updatedAt: null, source: 'live' };
const emptyIndicators = {
  qqq_drawdown_pct: null, symbol_drawdown_pct: null, z_score: null, z_score_as_of: null,
  ma200_slope_pct: null, sma_slope_pct: null, ttm_pe: null, ttm_pe_percentile: null,
  cnn_fear_greed: null, vix: null, ndx_pe: null,
};

function trade(overrides: Partial<DecisionTrade> = {}): DecisionTrade {
  return {
    id: 'trade-1', trade_time: '2026-10-13T04:37:24.000Z', recorded_by: 'position_ledger', symbol: 'TSLA',
    side: 'BUY', asset_type: 'stock', broker: 'IBKR', qty: 17, price: 380.29, amount: 6_464.93,
    price_source: 'broker_cost_delta', price_estimated: false,
    indicators: { ...emptyIndicators, qqq_drawdown_pct: 4.37, cnn_fear_greed: 31.46, vix: 16.46 },
    trigger: [], prediction: null, note: '', status: 'pending_note',
    resolved_at: null, resolved_price: null, result_pct: null, qqq_result_pct: null, vs_hold_pct: null,
    ...overrides,
  };
}

function log(overrides: Partial<DecisionLog> = {}): DecisionLog {
  return { version: 1, revision: 4, updated_at: '2026-10-16T08:00:00Z', trades: [], nav_series: [], cash_flows: [], ...overrides };
}

const render = (value: DecisionLog | null, qqq = [] as { date: string; close: number }[], sgov = [] as { date: string; close: number }[]) => renderToStaticMarkup(
  <DecisionJournalView log={value} qqqSeries={qqq} sgovSeries={sgov} displayCurrency="USD" rates={rates} />,
);

describe('日志页', () => {
  it('没有数据时也能打开，并说明数据从哪来', () => {
    const html = render(log());

    expect(html).toContain('决策日志');
    expect(html).toContain('命中率统计');
    expect(html).toContain('时间加权收益率 vs QQQ');
    expect(html).toContain('还没有抓到成交');
    expect(html).toContain('只记录，不下单');
  });

  it('待补充的交易高亮，并提示有几笔要补', () => {
    const html = render(log({ trades: [trade(), trade({ id: 'trade-2', status: 'in_progress', trigger: ['drawdown'], prediction: { type: 'beat_qqq', horizon_months: 3 } })] }));

    expect(html).toContain('有 1 笔交易待补充决策理由');
    expect(html).toContain('待补充');
    expect(html).toContain('TSLA · 买入 17');
    expect(html).toContain('买入后跑赢 QQQ');
    expect(html).toContain('+4.37%');
    expect(html).toContain('16.46');
  });

  it('命中率和基准并排显示，样本少时标不可靠', () => {
    const html = render(log({
      trades: [
        trade({ id: 'a', status: 'hit', prediction: { type: 'rebuy_after_dip', dip_pct: 10, reference_symbol: 'QQQ' }, vs_hold_pct: 19, amount: 10_000 }),
        trade({ id: 'b', status: 'miss', prediction: { type: 'rebuy_after_dip', dip_pct: 10, reference_symbol: 'QQQ' }, vs_hold_pct: -44, amount: 10_000 }),
      ],
    }));

    expect(html).toContain('卖出后等回调 10% 接回');
    expect(html).toContain('基准 62.00%');
    expect(html).toContain('样本太少，结论不可靠');
    expect(html).toContain('50.00%');
  });

  it('净值序列够长时给出 TWR 和基准对比', () => {
    const html = render(
      log({
        nav_series: [
          { date: '2026-09-30', nav: 100_000, captured_at: '2026-09-30T20:00:00Z' },
          { date: '2026-10-30', nav: 110_000, captured_at: '2026-10-30T20:00:00Z' },
        ],
      }),
      [{ date: '2026-09-30', close: 100 }, { date: '2026-10-30', close: 105 }],
      [{ date: '2026-09-30', close: 100 }, { date: '2026-10-30', close: 100 }],
    );

    expect(html).toContain('+10.00%');
    expect(html).toContain('同期满仓 QQQ');
    expect(html).toContain('+5.00%');
    expect(html).toContain('同期 60% QQQ + 40% SGOV');
    expect(html).toContain('+3.00%');
    expect(html).toContain('2026-10');
  });

  it('出入金和手动补录都在页面上', () => {
    const html = render(log({ cash_flows: [{ id: 'flow-1', date: '2026-10-16', amount: -5_000, note: '转出', created_at: '2026-10-16T08:00:00Z' }] }));

    expect(html).toContain('出入金登记（1 条）');
    expect(html).toContain('-$5,000.00');
    expect(html).toContain('手动补录过去的交易');
  });
});
