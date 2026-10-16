import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PeHistoryPayload } from '../peData';
import type { QuantForwardPeHistory, QuantIndexEtfValuation, QuantStockForwardValuation } from '../types';
import { StockForwardValuationExplorer } from './StockForwardValuationExplorer';

const ttmHistory: PeHistoryPayload = {
  generated_at: '2026-08-08T09:00:00-04:00',
  metric: 'ttm_pe',
  frequency: 'daily',
  percentile_definition: '当前 TTM PE 在5年历史中的分位',
  lookback_years: 5,
  symbols: {
    NVDA: {
      current: 34.3,
      percentile: 76.9,
      series_start: '2021-08-09',
      series_end: '2026-08-07',
      series: [
        { date: '2021-08-09', value: 62.1 },
        { date: '2024-08-08', value: 41.2 },
        { date: '2026-08-07', value: 34.3 },
      ],
      source: 'Futu OpenD',
      frequency: 'daily',
      updated_at: '2026-08-08T09:00:00-04:00',
    },
  },
};

const valuation: QuantStockForwardValuation = {
  generated_at: '2026-08-08T09:00:00-04:00',
  metric: 'forward_pe_1bf',
  source: 'Futu OpenD forward_value',
  symbols_order: ['NVDA', 'AAPL', 'GOOG', 'META', 'TSLA', 'AMZN', 'MSFT'],
  thresholds: { full_position_max: 22, low_max: 25, middle_max: 30, high_max: 32 },
  history_note: '远期 PE 从系统接入日开始逐日积累；未混入 TTM 历史。',
  symbols: {
    NVDA: {
      symbol: 'NVDA', current: 24.8, available: true, stale: false,
      as_of: '2026-08-08 08:55:00', source: 'Futu OpenD', unavailable_reason: null,
      zone: 'low', label: '低估值买入', icon: '🟢', message: '按计划分批买入或继续持有。',
      series: [{ date: '2026-08-07', value: 24.3 }, { date: '2026-08-08', value: 24.8 }],
      series_start: '2026-08-07', series_end: '2026-08-08',
    },
    TSLA: {
      symbol: 'TSLA', current: 33.2, available: true, stale: false,
      as_of: '2026-08-08 08:55:00', source: 'Futu OpenD', unavailable_reason: null,
      zone: 'exempt', label: '特殊估值观察', icon: '⚪',
      message: 'TSLA 不使用固定 PE 买卖阈值，仅展示估值数据。',
      series: [{ date: '2026-08-07', value: 32.9 }, { date: '2026-08-08', value: 33.2 }],
      series_start: '2026-08-07', series_end: '2026-08-08',
    },
  },
};

const indexDates = [
  '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02',
  '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07',
  '2026-08-08', '2026-08-09', '2026-08-10',
];

const indexForwardHistory: QuantForwardPeHistory = {
  generated_at: '2026-08-10T00:46:00-07:00',
  metric: 'forward_pe',
  frequency: 'daily',
  method: 'top_n_mktcap_weighted_yahoo_forward_eps',
  approximation_note: '前30大成分市值加权近似，非官方指数权重，与 Bloomberg BEst 1BF 会有偏差',
  history_ready: false,
  history_days: 13,
  history_days_required: 60,
  symbols: {
    NDX: {
      current: 24.12,
      percentile: null,
      percentile_unavailable_reason: '历史积累中 13/60 个交易日',
      series: indexDates.map((date, index) => ({ date, value: 23.8 + index * 0.02 })),
      series_start: '2026-07-29',
      series_end: '2026-08-10',
      constituents_used: 30,
      constituents_excluded: 0,
      weight_coverage_pct: 100,
    },
    SOX: {
      current: 21.79,
      percentile: null,
      percentile_unavailable_reason: '历史积累中 13/60 个交易日',
      series: indexDates.map((date, index) => ({ date, value: 20.91 + index * 0.07 })),
      series_start: '2026-07-29',
      series_end: '2026-08-10',
      constituents_used: 29,
      constituents_excluded: 1,
      weight_coverage_pct: 100,
    },
  },
};

describe('StockForwardValuationExplorer', () => {
  it('keeps a controlled symbol with no PE instead of showing the first available stock', () => {
    const html = renderToStaticMarkup(<StockForwardValuationExplorer compact selectedSymbol="XLK" ttmHistory={ttmHistory} />);
    expect(html).toContain('XLK · TTM PE 历史暂不可用');
    expect(html).not.toContain('当前 TTM PE 34.30');
  });
  it('synchronizes a requested index proxy and displays its basis explicitly', () => {
    const history: PeHistoryPayload = { ...ttmHistory, symbols: { ...ttmHistory.symbols, NDX: ttmHistory.symbols.NVDA } };
    const html = renderToStaticMarkup(<StockForwardValuationExplorer compact selectedSymbol="QQQ" ttmHistory={history} />);
    expect(html).toContain('QQQ · TTM PE');
    expect(html).toContain('QQQ 使用 NDX 指数 TTM PE');
    expect(html).toContain('非 ETF 自身 PE');
    expect(html).toContain('PE 历史位置 76.9%');
  });
  const issuerValuation: QuantIndexEtfValuation = {
    generated_at: '2026-10-05T08:00:00-04:00',
    symbols: { DIA: {
      symbol: 'DIA', available: true, basis_symbol: 'DJI', basis_name: '道琼斯工业平均指数',
      current_pe: 21.55, forward_pe: 18.99, as_of: '2026-10-02',
      source: 'State Street SPDR', source_url: 'https://www.ssga.com/',
      fetched_at: '2026-10-05T08:00:00-04:00', historical_available: false,
      history_note: '暂无可靠五年 PE 历史，不计算历史分位。', forward_note: 'FY1：下一财年盈利预测口径。',
    } },
  };

  it.each(['ttm', 'forward'] as const)('shows DIA official %s PE with its own date, without fabricating a history', (metric) => {
    const html = renderToStaticMarkup(<StockForwardValuationExplorer compact ttmHistory={ttmHistory} valuation={valuation} indexEtfValuation={issuerValuation} selectedSymbol="DIA" initialMetric={metric} />);
    expect(html).toContain('道琼斯工业平均指数');
    expect(html).toContain(metric === 'ttm' ? '21.55' : '18.99');
    expect(html).toContain('2026-10-02');
    expect(html).toContain('State Street SPDR');
    expect(html).toContain('暂无可靠五年 PE 历史');
    expect(html).not.toContain('5年历史分位');
    expect(html).not.toContain('NVDA · 低估值买入');
    expect(html).not.toContain('当前 TTM PE');
  });

  it('labels VOO as an index PE proxy and preserves its own selection when forward data is missing', () => {
    const historyWithVoo: PeHistoryPayload = { ...ttmHistory, symbols: { ...ttmHistory.symbols, VOO: { ...ttmHistory.symbols.NVDA, basis_symbol: 'SPX', basis_note: 'VOO 展示标普500指数 PE，价格、均线和回撤使用 VOO 自身数据。' } } };
    const html = renderToStaticMarkup(<StockForwardValuationExplorer compact ttmHistory={historyWithVoo} selectedSymbol="VOO" />);
    expect(html).toContain('VOO · TTM PE');
    expect(html).toContain('VOO 自身数据');
    const forward = renderToStaticMarkup(<StockForwardValuationExplorer compact ttmHistory={historyWithVoo} valuation={valuation} forwardIndexHistory={indexForwardHistory} selectedSymbol="VOO" initialMetric="forward" />);
    expect(forward).toContain('VOO · 远期 PE');
    expect(forward).not.toContain('NVDA · 低估值买入');
    expect(forward).not.toContain('NDX · 远期 PE');
  });

  it('keeps a failed DIA source explicit and never renders zero as PE', () => {
    const missing = { ...issuerValuation, symbols: { DIA: { ...issuerValuation.symbols.DIA, available: false, current_pe: null, forward_pe: null, as_of: null, stale: true } } };
    const html = renderToStaticMarkup(<StockForwardValuationExplorer compact indexEtfValuation={missing} selectedSymbol="DIA" />);
    expect(html).toContain('暂无数据');
    expect(html).toContain('数据已过期');
    expect(html).not.toContain('0.00');
  });
  it('defaults to the complete TTM history and offers a forward PE switch', () => {
    const html = renderToStaticMarkup(
      <StockForwardValuationExplorer valuation={valuation} ttmHistory={ttmHistory} />,
    );

    expect(html).toContain('TTM（5年历史）');
    expect(html).toContain('远期（预测）');
    expect(html).toContain('股票与指数估值');
    expect(html).not.toContain('七巨头');
    expect(html).toContain('NVDA · TTM PE');
    expect(html).toContain('当前 TTM PE 34.30');
    expect(html).toContain('5年分位 76.9%');
    expect(html).toContain('2021-08-09');
    expect(html).not.toContain('NVDA · 低估值买入');
  });

  it('adds every symbol that has a real TTM series even when it is not in the forward seven', () => {
    const expandedHistory: PeHistoryPayload = {
      ...ttmHistory,
      symbols: {
        ...ttmHistory.symbols,
        AVGO: {
          ...ttmHistory.symbols.NVDA,
          current: 31.2,
          series: [{ date: '2021-08-09', value: 38 }, { date: '2026-08-07', value: 31.2 }],
        },
      },
    };

    const html = renderToStaticMarkup(
      <StockForwardValuationExplorer valuation={valuation} ttmHistory={expandedHistory} selectedSymbol="AVGO" />,
    );

    expect(html).toContain('AVGO');
    expect(html).toContain('博通');
    expect(html).toContain('AVGO · TTM PE');
  });

  it('refuses to present a forward history payload as TTM', () => {
    const html = renderToStaticMarkup(
      <StockForwardValuationExplorer
        valuation={valuation}
        ttmHistory={{ ...ttmHistory, metric: 'forward_pe' }}
      />,
    );

    expect(html).toContain('NVDA · TTM PE 历史暂不可用');
    expect(html).not.toContain('当前 TTM PE 34.30');
  });

  it('shows only available forward symbols, current forward PE, fixed zones, and short action', () => {
    const html = renderToStaticMarkup(
      <StockForwardValuationExplorer valuation={valuation} initialMetric="forward" />,
    );

    expect(html).toContain('NVDA');
    expect(html).toContain('TSLA');
    expect(html).not.toContain('AAPL');
    expect(html).toContain('NVDA · 低估值买入');
    expect(html).toContain('当前远期 PE 24.80');
    expect(html).toContain('按计划分批买入或继续持有。');
    expect(html).toContain('22');
    expect(html).toContain('25');
    expect(html).toContain('30');
    expect(html).toContain('32');
    expect(html).toContain('Futu OpenD');
    expect(html).not.toContain('当前 TTM PE');
  });

  it('shows TSLA as a special valuation exemption instead of an ultra-high sell signal', () => {
    const html = renderToStaticMarkup(
      <StockForwardValuationExplorer
        valuation={valuation}
        initialMetric="forward"
        selectedSymbol="TSLA"
      />,
    );

    expect(html).toContain('TSLA · 特殊估值观察');
    expect(html).toContain('TSLA 不使用固定 PE 买卖阈值');
    expect(html).not.toContain('TSLA · 超高估值');
  });

  it('shows the exported SOX index forward PE and its honest history accumulation state', () => {
    const html = renderToStaticMarkup(
      <StockForwardValuationExplorer
        valuation={valuation}
        ttmHistory={ttmHistory}
        forwardIndexHistory={indexForwardHistory}
        initialMetric="forward"
        selectedSymbol="SOX"
      />,
    );

    expect(html).toContain('SOX');
    expect(html).toContain('费城半导体');
    expect(html).toContain('SOX · 远期 PE · 历史积累中');
    expect(html).toContain('当前远期 PE 21.79');
    expect(html).toContain('13/60 个交易日');
    expect(html).toContain('29/30 个成分可用');
    expect(html).toContain('非官方指数权重');
    expect(html).not.toContain('SOX · 低估值买入');
  });

  it('keeps the requested SPX selected and reports missing forward data', () => {
    const historyWithSpx: PeHistoryPayload = {
      ...ttmHistory,
      symbols: {
        ...ttmHistory.symbols,
        SPX: {
          ...ttmHistory.symbols.NVDA,
          current: 26.03,
          series: [{ date: '2021-08-09', value: 27.1 }, { date: '2026-08-07', value: 26.03 }],
        },
      },
    };
    const html = renderToStaticMarkup(
      <StockForwardValuationExplorer
        valuation={valuation}
        ttmHistory={historyWithSpx}
        forwardIndexHistory={indexForwardHistory}
        initialMetric="forward"
        selectedSymbol="SPX"
      />,
    );

    expect(html).not.toContain('NVDA · 低估值买入');
    expect(html).toContain('SPX · 远期 PE 数据不可判定');
  });
});
