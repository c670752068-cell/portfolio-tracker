import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { QuantAnalysisSnapshot } from '../types';
import type { VolatilityItem } from '../volatilityIndex';
import { MarketIndicators, VxsmhCard } from './ValuationPanel';

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

describe('标普 500 估值的位置换成 VXSMH', () => {
  const item = (overrides: Partial<VolatilityItem> = {}): VolatilityItem => ({
    key: 'VXSMH', name: '半导体', symbol: '^VXSMH', price: 65.89, changePercent: 43.8,
    quoteTime: '2026-11-05T21:02:02.000Z', series: [], ...overrides,
  });

  it('不再有标普 500 估值，VXSMH 排在纳指估值和 VIX 中间，还是四张卡片', () => {
    const value = snapshot();
    const original = structuredClone(value);
    const html = renderToStaticMarkup(<MarketIndicators snapshot={value} />);

    expect(html).not.toContain('标普500 估值');
    expect(html).not.toContain('dj-valuation-table-detail/SP500');
    expect(html.indexOf('纳指100 估值')).toBeLessThan(html.indexOf('VXSMH 半导体波动率'));
    expect(html.indexOf('VXSMH 半导体波动率')).toBeLessThan(html.indexOf('VIX 波动率'));
    expect(html).toContain('xl:grid-cols-4');
    expect(html.match(/col-span-2 xl:col-span-1/g)).toHaveLength(2);
    expect(html.match(/<section /g)).toHaveLength(4);
    expect(value).toEqual(original);
  });

  it('显示当前值、所在区间、较昨收和数据日期，并写明 40 和 55 两条线', () => {
    const html = renderToStaticMarkup(<VxsmhCard item={item()} />);

    expect(html).toContain('VXSMH 65.89');
    expect(html).toContain('高波动 · 较昨收 +43.80%');
    expect(html).toContain('平稳 &lt; 40 · 高波动 ≥ 55');
    expect(html).toContain('数据 11-05');
    expect(html).toContain('Yahoo · 2026-11-05');
    expect(html).not.toContain('PE');
  });

  it.each([
    [39.99, '平稳', 'normal', 'bg-gain text-white'],
    [40, '平常', 'neutral', 'bg-neutral/40 text-ink-muted'],
    [54.99, '平常', 'neutral', 'bg-neutral/40 text-ink-muted'],
    [55, '高波动', 'ready', 'bg-loss text-white'],
  ] as const)('%s 是%s', (price, label, state, badge) => {
    const html = renderToStaticMarkup(<VxsmhCard item={item({ price })} />);

    expect(html).toContain(`data-alert-state="${state}"`);
    expect(html).toContain(`${badge}">${label} · 较昨收`);
  });

  it('颜色看区间，不看当天涨跌：高波动当天回落也标红', () => {
    const html = renderToStaticMarkup(<VxsmhCard item={item({ price: 60, changePercent: -2.5 })} />);

    expect(html).toContain('bg-loss text-white">高波动 · 较昨收 -2.50%');
  });

  it('拿不到数据写暂无，不编数', () => {
    const html = renderToStaticMarkup(<VxsmhCard item={null} />);

    expect(html).toContain('暂无');
    expect(html).toContain('较昨收 暂无');
    expect(html).not.toContain('平稳 ·');
    expect(html).not.toContain('平常 ·');
    expect(html).not.toContain('高波动 ·');
    expect(html).toContain('数据 --');
    expect(html).not.toContain('数据过期');
  });
});

describe('CNN 和 VIX 卡片的徽章：当前仓位、上限、超没超', () => {
  const value = (): QuantAnalysisSnapshot => {
    const next = snapshot();
    next.valuation_tab!.cnn.current_score = 19.85;
    next.context = { vix: { available: true, value: 28.18, as_of: '2026-11-05' } };
    return next;
  };
  const card = (html: string, title: string) => html.split('<section').find((part) => part.includes(`aria-label="${title}"`)) ?? '';

  it('超了：两张卡片都写当前仓位和上限，标红', () => {
    const html = renderToStaticMarkup(<MarketIndicators snapshot={value()} positionBadge={{ text: '仓位 55.3% · 上限 50% · 超了', over: true }} />);

    for (const title of ['市场情绪 · CNN 恐慌贪婪指数', 'VIX 波动率']) {
      expect(card(html, title)).toContain('仓位 55.3% · 上限 50% · 超了');
      expect(card(html, title)).toMatch(/bg-loss text-white[^>]*>(<[^>]*>)*仓位 55\.3%/);
    }
    expect(html).not.toContain('可开仓');
    expect(html).not.toContain('波动警戒');
  });

  it('没超标绿', () => {
    const html = renderToStaticMarkup(<MarketIndicators snapshot={value()} positionBadge={{ text: '仓位 28.0% · 上限 30% · 没超', over: false }} />);

    expect(card(html, 'VIX 波动率')).toMatch(/bg-gain text-white[^>]*>(<[^>]*>)*仓位 28\.0%/);
  });

  it('写明门槛：CNN 20 以内才能超 30%，VIX 25 以上才能到 50%', () => {
    const html = renderToStaticMarkup(<MarketIndicators snapshot={value()} />);

    expect(card(html, '市场情绪 · CNN 恐慌贪婪指数')).toContain('CNN ≤ 20 才能超 30%');
    expect(card(html, 'VIX 波动率')).toContain('VIX ≥ 25 才能到 50%');
  });
});
