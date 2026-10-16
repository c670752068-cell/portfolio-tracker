import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { pePosition, smaIndicators } from '../decisionIndicators';
import { PePositionView, SmaPositionView } from './DecisionIndicatorViews';
import { SmaOverheatDetails } from './SmaOverheatDetails';
import type { QuantMaSlopeDashboard } from '../types';

describe('decision indicator views', () => {
  const data: QuantMaSlopeDashboard = { range: '5y', slope_window_sessions: 8, slope_unit: 'pct_per_day', ma_periods: [20, 50, 200], series: [{ date: '2026-10-02', open: 1, high: 1, low: 1, close: 1, volume: 1, slope20: .2, slope50: .1, slope200: .01 }, { date: '2026-10-05', open: 1, high: 1, low: 1, close: 1, volume: 1, slope20: -.2, slope50: -.03, slope200: -.002 }] };
  it('keeps the compact zero-cross state without a large warning block', () => {
    const value = smaIndicators(data);
    const html = renderToStaticMarkup(<SmaPositionView value={value} />);
    expect(html).toContain('200DMA 下穿零轴');
    expect(html).toContain('20DMA -0.200');
    expect(html).toContain('50DMA');
    expect(html).toContain('2026-10-05');
    expect(html).toContain('下降中位');
    expect(html).toContain('样本不足，仅供参考');
    expect(html).not.toContain('上升中位');
    expect(html).not.toContain('重点检查');
    expect(html).not.toContain('trend-risk-warning');
  });
  it('highlights the signed negative median matching a falling 20DMA and switches with the current direction', () => {
    const history = { ...data, series: Array.from({ length: 300 }, (_, i) => ({
      date: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10), open: 100, high: 100, low: 100,
      close: i % 25 === 18 ? 104 : 100, slope20: i % 25 === 8 ? -.5 : .1, volume: 1,
    })) };
    history.series.at(-1)!.slope20 = -.6;
    const value = smaIndicators(history);
    const html = renderToStaticMarkup(<SmaPositionView value={value} compact />);
    expect(html).toContain('class="indicator-down">20DMA -0.600');
    expect(html).toContain('data-direction="down"');
    expect(html).toContain('下降中位 <b>-0.500</b>');
    expect(html).toContain('下降偏快');
    expect(html).not.toContain('上升中位');
    const detail = renderToStaticMarkup(<SmaOverheatDetails value={value} />);
    expect(detail).toContain('反弹至少 3%');
    expect(detail).toContain('最大收盘反弹 +4.00%');
    expect(detail.indexOf('下降参考')).toBeLessThan(detail.indexOf('上升参考'));
    expect(detail).toContain('不是预测胜率');
    history.series.at(-1)!.slope20 = .6;
    const up = renderToStaticMarkup(<SmaPositionView value={smaIndicators(history)} compact />);
    expect(up).toContain('data-direction="up"');
    expect(up).toContain('上升中位');
    expect(up).not.toContain('下降中位');
  });
  it('never highlights missing or zero slopes as downward signals', () => {
    for (const slope20 of [0, null]) {
      const history = { ...data, series: [{ ...data.series[0], slope20 }] };
      const html = renderToStaticMarkup(<SmaPositionView value={smaIndicators(history)} compact />);
      expect(html).not.toContain('is-falling');
      expect(html).not.toContain('is-downside');
      expect(html).not.toContain('下降中位');
    }
  });
  it('has explicit unavailable PE without a fabricated position dot', () => {
    const html = renderToStaticMarkup(<PePositionView value={pePosition('UNKNOWN')} />);
    expect(html).toContain('暂无可靠 PE');
    expect(html).not.toContain('position-track');
    expect(html).not.toContain('0.00');
  });
});
