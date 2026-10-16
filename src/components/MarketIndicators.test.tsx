import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PeHistoryPayload } from '../peData';
import type { QuantAnalysisSnapshot } from '../types';
import { MarketIndicators } from './ValuationPanel';

function snapshot(): QuantAnalysisSnapshot {
  return {
    source: 'futu-assistant', generated_at: '2026-10-07T02:19:00-04:00', rule_version: '2.2', disclaimer: '', context: {}, symbols: {},
    valuation_tab: {
      available: true, generated_at: '2026-10-07T02:19:00-04:00',
      ndx: { available: true, current_pe: 30.95, current_pb: 9.49, pe_percentile_5y: 28.29, zone: '偏低', percentile_lines: { p30: 31, median: 34, p70: 35 }, history: [], source: 'danjuanfunds', as_of: '2026-09-29', realtime_estimate: null },
      cnn: { available: true, current_score: 47, rating: 'neutral', history: [], source: 'cnn', as_of: '2026-10-07' }, anchors: [], distance_to_anchors: [],
    },
    pe_history: {
      generated_at: '2026-10-07T02:19:00-04:00', metric: 'ttm_pe', frequency: 'source_native', percentile_definition: 'historical rank', lookback_years: 5,
      symbols: { SPX: { current: 25.1434, percentile: 39.76834, series_start: '2021-09-29', series_end: '2026-09-29', source: 'Danjuan/Xueqiu', frequency: 'weekly', series: [{ date: '2021-09-29', value: 26 }, { date: '2026-09-29', value: 25.1434 }] } },
    },
  };
}

function spxCard(value: QuantAnalysisSnapshot) {
  const html = renderToStaticMarkup(<MarketIndicators snapshot={value} />);
  return html.match(/<section[^>]*aria-label="标普500 估值"[\s\S]*?<\/section>/)?.[0] ?? '';
}

describe('market indicator SP500 card', () => {
  it('places SP500 between Nasdaq and VIX in both overview and decision shared indicators', () => {
    const value = snapshot();
    const original = structuredClone(value);
    const html = renderToStaticMarkup(<MarketIndicators snapshot={value} />);
    expect(html.indexOf('纳指100 估值')).toBeLessThan(html.indexOf('标普500 估值'));
    expect(html.indexOf('标普500 估值')).toBeLessThan(html.indexOf('VIX 波动率'));
    expect(html).toContain('xl:grid-cols-4');
    expect(html.match(/col-span-2 xl:col-span-1/g)).toHaveLength(2);
    expect(html.match(/<section /g)).toHaveLength(4);
    expect(html).toContain('href="https://danjuanfunds.com/dj-valuation-table-detail/SP500"');
    expect(html).toContain('双击查看雪球标普500估值，按回车也可打开');
    expect(value).toEqual(original);
  });

  it('uses SPX TTM PE and the existing five-year rank, not Nasdaq or the provider default rank', () => {
    const card = spxCard(snapshot());
    expect(card).toContain('PE 25.14');
    expect(card).toContain('5年分位 39.77%');
    expect(card).toContain('历史中位 PE 25.57');
    expect(card).toContain('历史偏低');
    expect(card).toContain('历史 · 2026-09-29');
    expect(card).not.toContain('2026-10-07');
    expect(card).not.toContain('30.95');
    expect(card).not.toContain('警戒线 PE');
    expect(card).not.toContain('可开仓');
  });

  it.each([[20, '历史低位', 'normal'], [50, '历史中区', 'neutral'], [80, '历史偏高', 'warning'], [95, '历史高位', 'danger']] as const)(
    'uses the same historical classification as decisions at percentile %s', (percentile, label, state) => {
      const value = snapshot();
      value.pe_history!.symbols.SPX.percentile = percentile;
      const card = spxCard(value);
      expect(card).toContain(label);
      expect(card).toContain(`data-alert-state="${state}"`);
      expect(card).not.toContain('可开仓');
    },
  );

  it('does not turn missing or forward-only data into an SP500 valuation', () => {
    for (const history of [undefined, { ...snapshot().pe_history!, metric: 'forward_pe' as const }]) {
      const card = spxCard({ ...snapshot(), pe_history: history });
      expect(card).toContain('暂无可靠 PE');
      expect(card).toContain('5年分位 暂无');
      expect(card).not.toContain('PE 30.95');
      expect(card).not.toContain('PE 0.00');
      expect(card).not.toContain('数据过期');
    }
  });

  it('does not invent a historical position or date from the overall snapshot', () => {
    const value = snapshot();
    const entry = value.pe_history!.symbols.SPX;
    entry.percentile = null;
    entry.series_end = undefined;
    entry.series = [];
    const card = spxCard(value);
    expect(card).toContain('PE 25.14');
    expect(card).toContain('历史位置未知');
    expect(card).toContain('历史 · 日期暂无');
    expect(card).not.toContain('2026-10-07');
    expect(card).not.toContain('历史中位 PE 0.00');
  });

  it('keeps the history window and last observation date honest', () => {
    const value = snapshot();
    value.pe_history!.lookback_years = 3;
    value.pe_history!.symbols.SPX.series_end = undefined;
    const card = spxCard(value);
    expect(card).toContain('3年分位 39.77%');
    expect(card).toContain('历史 · 2026-09-29');
  });

  it.each([NaN, Infinity, 0, -1])('does not display invalid PE %s as usable', current => {
    const value = snapshot();
    (value.pe_history as PeHistoryPayload).symbols.SPX.current = current;
    const card = spxCard(value);
    expect(card).toContain('暂无可靠 PE');
    expect(card).not.toMatch(/NaN|Infinity|PE 0\.00|PE -1\.00/);
  });
});
