import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PeHistoryPayload, PeSnapshot } from '../peData';
import type { AppSettings, Holding, QuantAnalysisSnapshot } from '../types';
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

const rates = {
  USD: 1,
  CNY: 6.7776,
  HKD: 7.8386,
  JPY: 155,
  EUR: 0.92,
  GBP: 0.79,
  updatedAt: '2026-07-23T12:00:00Z',
  source: 'live' as const,
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
  it('shows the current holding quote beside the PE value', () => {
    const html = renderToStaticMarkup(
      <ValuationCard
        symbol="GOOG"
        history={history('GOOG', 20, [{ date: '2026-07-22', value: 20 }])}
        settings={settings}
        currentPrice={402.15}
        priceSource="holding"
        displayCurrency="USD"
        rates={rates}
      />,
    );

    expect(html).toContain('GOOG');
    expect(html).toContain('$402.15');
    expect(html).toContain('TTM PE 20.00');
    expect(html).toContain('data-price-source="holding"');
  });

  it('shows a monitored quote and converts it through the display-currency layer', () => {
    const usdHtml = renderToStaticMarkup(
      <ValuationCard
        symbol="GOOG"
        history={history('GOOG', 20, [{ date: '2026-07-22', value: 20 }])}
        settings={settings}
        currentPrice={100}
        priceSource="monitored"
        displayCurrency="USD"
        rates={rates}
      />,
    );
    const cnyHtml = renderToStaticMarkup(
      <ValuationCard
        symbol="GOOG"
        history={history('GOOG', 20, [{ date: '2026-07-22', value: 20 }])}
        settings={settings}
        currentPrice={100}
        priceSource="monitored"
        displayCurrency="CNY"
        rates={rates}
      />,
    );

    expect(usdHtml).toContain('$100.00');
    expect(usdHtml).toContain('data-price-source="monitored"');
    expect(cnyHtml).toContain('¥677.76');
  });

  it('shows 股价暂无 rather than zero when neither quote source has data', () => {
    const html = renderToStaticMarkup(
      <ValuationCard
        symbol="GOOG"
        history={history('GOOG', 20, [{ date: '2026-07-22', value: 20 }])}
        settings={settings}
        currentPrice={null}
        priceSource="unavailable"
        displayCurrency="USD"
        rates={rates}
      />,
    );

    expect(html).toContain('股价暂无');
    expect(html).not.toContain('$0.00');
  });

  it('shows the stock price implied by a lower five-year mean PE', () => {
    const html = renderToStaticMarkup(
      <ValuationCard
        symbol="GOOG"
        history={history('GOOG', 30, [{ date: '2026-07-22', value: 21.6 }])}
        settings={settings}
        currentPrice={400}
        priceSource="holding"
        displayCurrency="USD"
        rates={rates}
      />,
    );

    expect(html).toContain('PE 回到 5 年均值 21.60 对应股价 ~$288.00（需下跌 28.00%）');
    expect(html).toContain('按当前每股收益不变推算；实际 EPS 会随财报变化，仅供参考。');
  });

  it('shows the stock price implied by a higher five-year mean PE', () => {
    const html = renderToStaticMarkup(
      <ValuationCard
        symbol="GOOG"
        history={history('GOOG', 20, [{ date: '2026-07-22', value: 24.8 }])}
        settings={settings}
        currentPrice={400}
        priceSource="holding"
        displayCurrency="USD"
        rates={rates}
      />,
    );

    expect(html).toContain('PE 回到 5 年均值 24.80 对应股价 ~$496.00（需上涨 24.00%）');
  });

  it('uses the regular index proxy ETF price for an index anchor target', () => {
    const html = renderToStaticMarkup(
      <ValuationCard
        symbol="QQQ"
        history={history('NDX', 30, [{ date: '2025-04-08', value: 21.6 }])}
        settings={settings}
        currentPrice={400}
        priceSource="monitored"
        displayCurrency="USD"
        rates={rates}
      />,
    );

    expect(html).toContain('QQQ · $400.00 · 基准指数 NDX · TTM PE 30.00');
    expect(html).toContain('NDX 回到 2025-04 锚点 21.60 对应 QQQ ~$288.00（需下跌 28.00%）');
  });

  it('does not derive a target price for leveraged ETFs because of path dependency', () => {
    const html = renderToStaticMarkup(
      <ValuationCard
        symbol="TQQQ"
        history={history('NDX', 30, [{ date: '2025-04-08', value: 21.6 }])}
        settings={settings}
        currentPrice={50}
        priceSource="holding"
        displayCurrency="USD"
        rates={rates}
      />,
    );

    expect(html).toContain('TQQQ · $50.00');
    expect(html).toContain('杠杆 ETF 因每日重置存在路径依赖，不推算目标价；请参考上方基准指数的目标价');
    expect(html).not.toContain('对应 TQQQ');
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it('does not fall back to a deeper historical low when the April 2025 window has no data', () => {
    const html = renderToStaticMarkup(
      <ValuationCard
        symbol="QQQ"
        history={history('NDX', 30, [
          { date: '2022-10-15', value: 10 },
          { date: '2026-07-22', value: 30 },
        ])}
        settings={settings}
        currentPrice={400}
        priceSource="holding"
        displayCurrency="USD"
        rates={rates}
      />,
    );

    expect(html).toContain('锚点窗口内无数据，可在设置手动录入');
    expect(html).toContain('锚点 = 2025 年 4 月关税冲击期间的最低 PE。当前不使用更深的历史/熊市极值作为基准。');
    expect(html).not.toContain('锚点 10.00');
    expect(html).not.toContain('对应 QQQ');
  });

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

    expect(html).toContain('GOOG · 股价暂无 · TTM PE 20.00');
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

    expect(html).toContain('TQQQ · 股价暂无 · 基准指数 NDX · TTM PE 22.50');
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
    expect(html).toContain('AAPL · 股价暂无 · TTM PE 20.00');
  });

  it('prefers a holding quote and otherwise passes the monitored quote to the valuation card', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.pe_history = history('AAPL', 20, [{ date: '2026-07-22', value: 20 }]);
    const holdings: Holding[] = [{
      id: 'aapl',
      symbol: 'AAPL',
      name: 'Apple',
      shares: 1,
      buyPrice: 190,
      currentPrice: 201,
      sector: '科技',
      currency: 'USD' as const,
      assetType: 'stock' as const,
      quote: {
        symbol: 'AAPL',
        price: 202,
        previousClose: 200,
        change: 2,
        changePercent: 1,
        currency: 'USD',
        timestamp: '2026-07-23T12:00:00Z',
        source: 'proxy',
      },
    }];
    const monitored = new Map([['AAPL', 199]]);

    const holdingHtml = renderToStaticMarkup(
      <ConditionLookup
        snapshot={snapshot}
        initialSymbol="AAPL"
        holdings={holdings}
        monitoredQuotes={monitored}
        valuationSettings={settings}
      />,
    );
    const monitoredHtml = renderToStaticMarkup(
      <ConditionLookup
        snapshot={snapshot}
        initialSymbol="AAPL"
        monitoredQuotes={monitored}
        valuationSettings={settings}
      />,
    );

    expect(holdingHtml).toContain('$202.00');
    expect(holdingHtml).toContain('data-price-source="holding"');
    expect(monitoredHtml).toContain('$199.00');
    expect(monitoredHtml).toContain('data-price-source="monitored"');
  });
});
