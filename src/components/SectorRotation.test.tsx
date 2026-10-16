import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PerformanceChart, RotationMap, SectorRotation } from './SectorRotation';
import { relativePerformance, type RotationHistory } from '../sectorRotation';

describe('sector rotation presentation', () => {
  it('uses a real-data loading state, four periods and explicit calculation boundaries', () => {
    const html = renderToStaticMarkup(<SectorRotation snapshot={null} holdings={[]} onOpenDecision={() => {}} />);
    expect(html).toContain('板块强弱与轮动');
    expect(html).toContain('标普500 · SPY');
    expect(html).toContain('11大板块排名');
    for (const label of ['1月', '3月', '6月', '1年']) expect(html).toContain(`>${label}</button>`);
    expect(html).toContain('非专有 JdK RRG');
    expect(html).toContain('百分点');
    expect(html).toContain('不改变现有决策、推送或交易规则');
    expect(html).not.toContain('演示数据 · 非实时行情');
    expect(html).not.toContain('+10.0%');
  });
  it('provides keyboard-selectable SVG points with dates and avoids replacing missing points', () => {
    const html = renderToStaticMarkup(<RotationMap rows={[{ symbol: 'XLK', name: '科技', trail: [{ date: '2026-10-02', x: 102, y: 101, state: 'leading' }], performance: relativePerformance(undefined, undefined, 63) }]} selected="XLK" onSelect={() => {}} />);
    expect(html).toContain('role="button" tabindex="0"');
    expect(html).toContain('2026-10-02');
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('NaN');
  });
  it('plots two rebased price series, not an excess-return series disguised as price', () => {
    const history = (end: number): RotationHistory => ({ symbol: 'TEST', available: true, stale: false, adjustment: 'split_and_dividend_adjusted', series: [{ date: '2026-10-01', close: 100 }, { date: '2026-10-02', close: end }] });
    const performance = relativePerformance(history(110), history(105), 1);
    const html = renderToStaticMarkup(<PerformanceChart performance={performance} symbol="XLK" />);
    expect(html).toContain('110.00');
    expect(html).toContain('105.00');
    expect(html).toContain('起点100');
  });
});
