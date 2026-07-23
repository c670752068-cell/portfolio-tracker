import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PeHistoryPayload, PeSnapshot } from '../peData';
import type { AppSettings, QuantAnalysisSnapshot } from '../types';
import { quantAnalysisFixture } from '../testFixtures/quantAnalysis';
import { ConditionLookup } from './ConditionLookup';
import { ValuationCard } from './ValuationCard';

const settings: AppSettings = {
  aiProvider: 'zhipu',
  kimiApiKey: '',
  kimiModel: 'kimi-k2.6',
  proxyUrl: '',
  zhipuApiKey: '',
  zhipuModel: 'glm-4.6v-flash',
  zhipuProxyUrl: '',
  quoteProvider: 'none',
  quoteApiKey: '',
  peApiKey: '',
  quoteProxyUrl: '',
  autoRefreshQuotes: true,
  displayCurrency: 'USD',
  exposureTargetPct: 100,
  quantSyncEnabled: true,
  quantSyncToken: '',
  valuationAnchorStart: '2025-04-01',
  valuationAnchorEnd: '2025-04-30',
  valuationManualAnchors: {},
  valuationAtAnchorPct: 5,
  valuationNearAnchorPct: 15,
};

function history(
  symbol: string,
  current: number,
  series: Array<{ date: string; value: number }>,
): PeHistoryPayload {
  return {
    generated_at: '2026-07-22T12:00:00Z',
    metric: 'ttm_pe',
    frequency: 'weekly',
    percentile_definition: '0=历史最低，100=历史最高',
    lookback_years: 5,
    symbols: {
      [symbol]: {
        current,
        percentile: 40,
        series_start: series[0]?.date ?? '',
        series_end: series.at(-1)?.date,
        series,
        source: 'Futu OpenD',
        frequency: 'weekly',
      },
    },
  };
}

describe('ValuationCard', () => {
  it('renders a stock five-year mean, deviation, metric, and source without mixing PE definitions', () => {
    const html = renderToStaticMarkup(
      <ValuationCard
        symbol="GOOG"
        history={history('GOOG', 20, [
          { date: '2021-07-22', value: 99 },
          { date: '2021-07-24', value: 20 },
          { date: '2023-07-22', value: 25 },
          { date: '2026-07-22', value: 30 },
        ])}
        settings={settings}
      />,
    );

    expect(html).toContain('GOOG · TTM PE 20.00');
    expect(html).toContain('5 年均值 25.00');
    expect(html).toContain('当前低于均值 20.00%');
    expect(html).toContain('数据：量化系统（TTM PE）');
    expect(html).toContain('序列起始 2021-07-22');
    expect(html).not.toContain('远期 PE');
  });

  it('renders an index anchor, date, distance, and green zone from the configured window', () => {
    const html = renderToStaticMarkup(
      <ValuationCard
        symbol="TQQQ"
        history={history('NDX', 22.5, [
          { date: '2025-04-08', value: 21.6 },
          { date: '2025-04-15', value: 22.1 },
          { date: '2026-07-22', value: 22.5 },
        ])}
        settings={settings}
      />,
    );

    expect(html).toContain('TQQQ · 基准指数 NDX · TTM PE 22.50');
    expect(html).toContain('锚点 21.60（2025-04-08）');
    expect(html).toContain('距锚点 +4.17%');
    expect(html).toContain('已进入锚点区');
    expect(html).toContain('data-zone="at_anchor"');
    expect(html).toContain('锚点：序列自动计算');
  });

  it('marks an approximate index mapping and an Alpha Vantage manual-anchor fallback honestly', () => {
    const alphaSnapshot: PeSnapshot = {
      symbol: 'NDX',
      forwardPe: 22.5,
      trailingPe: null,
      source: 'alphavantage',
      fetchedAt: '2026-07-22T12:00:00Z',
    };
    const html = renderToStaticMarkup(
      <ValuationCard
        symbol="TECL"
        history={null}
        alphaSnapshot={alphaSnapshot}
        settings={{ ...settings, valuationManualAnchors: { NDX: 21.6 } }}
      />,
    );

    expect(html).toContain('近似基准');
    expect(html).toContain('远期 PE 22.50');
    expect(html).toContain('数据：Alpha Vantage（远期 PE）');
    expect(html).toContain('锚点：手动录入');
  });

  it('renders unavailable data as 暂无 without zero, NaN, or Infinity', () => {
    const html = renderToStaticMarkup(
      <ValuationCard symbol="SOXL" history={null} settings={settings} />,
    );

    expect(html).toContain('暂无');
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html).not.toContain('PE 0');
  });

  it('contains no action wording forbidden by the display-only contract', () => {
    const html = renderToStaticMarkup(
      <ValuationCard
        symbol="TQQQ"
        history={history('NDX', 22.5, [{ date: '2025-04-08', value: 21.6 }])}
        settings={settings}
      />,
    );

    const forbidden = ['建议' + '买入', '可' + '买', '触发' + '买入'];
    forbidden.forEach((word) => expect(html).not.toContain(word));
  });
});

describe('ConditionLookup valuation integration', () => {
  it('renders the selected symbol valuation card from the same quant snapshot', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.pe_history = history('AAPL', 20, [
      { date: '2021-07-22', value: 20 },
      { date: '2023-07-22', value: 25 },
      { date: '2026-07-22', value: 30 },
    ]);

    const html = renderToStaticMarkup(
      <ConditionLookup
        snapshot={snapshot}
        initialSymbol="AAPL"
        valuationSettings={settings}
      />,
    );

    expect(html).toContain('估值基准');
    expect(html).toContain('AAPL · TTM PE 20.00');
  });
});
