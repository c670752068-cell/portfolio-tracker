import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DecisionAction } from '../decisionAction';
import { DecisionAnswerPanel, type DecisionQuote } from './DecisionAnswerPanel';

const action: DecisionAction = { kind: 'hold', label: '继续持有', reason: '不展示的原因', next: '不展示的下一步', detail: '不展示的详细规则' };
const closed: DecisionQuote = { date: '2026-10-05', close: 362.51, z: -0.14, annualSlope: -6.78, slopeDate: '2026-10-05' };
const preview: DecisionQuote = { date: '2026-10-06', close: 375.23, z: 0.23, annualSlope: -7.21, slopeDate: '2026-10-06' };
const props = { symbol: 'AVGO', name: '博通', held: true, action, closed, preview, onModeChange: () => {}, onReturnToList: () => {} };

describe('DecisionAnswerPanel', () => {
  it('shows the conclusion and closed values with both controls directly accessible', () => {
    const html = renderToStaticMarkup(<DecisionAnswerPanel {...props} mode="closed" />);
    expect(html).toContain('继续持有');
    expect(html).toContain('已持仓');
    expect(html).toContain('$362.51');
    expect(html).toContain('-0.14');
    expect(html).toContain('-6.78%');
    expect(html).toContain('买入观察');
    expect(html).toContain('aria-pressed="true">完整收盘');
    expect(html).toContain('aria-pressed="false">盘中预览');
    expect(html).not.toContain('未收盘确认');
    expect(html).not.toContain('$375.23');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('不展示');
  });

  it('switches to unconfirmed intraday quotes without turning their Z sign into a different verdict', () => {
    const html = renderToStaticMarkup(<DecisionAnswerPanel {...props} mode="preview" />);
    expect(html).toContain('继续持有');
    expect(html).toContain('$375.23');
    expect(html).toContain('+0.23');
    expect(html).toContain('-7.21%');
    expect(html).toContain('卖出观察');
    expect(html).toContain('未收盘确认');
    expect(html).toContain('2026-10-06');
    expect(html).toContain('aria-pressed="true">盘中预览');
    expect(html).not.toContain('$362.51');
    expect(html).not.toContain('2026-10-05');
    expect(html).not.toContain('按计划卖出');
  });

  it('does not fill a missing preview with closed prices or old data', () => {
    const html = renderToStaticMarkup(<DecisionAnswerPanel {...props} preview={null} mode="preview" />);
    expect(html).toContain('继续持有');
    expect(html).toContain('暂无盘中数据');
    expect(html).not.toContain('$362.51');
    expect(html).not.toContain('-0.14');
    expect(html).not.toContain('未收盘确认');
  });

  it('leaves invalid values unavailable and preserves a different slope date', () => {
    const html = renderToStaticMarkup(<DecisionAnswerPanel {...props} action={{ ...action, kind: 'review', label: '待核查' }}
      closed={{ date: null, close: NaN, z: null, annualSlope: null, slopeDate: '2026-10-02' }} mode="closed" />);
    expect(html).toContain('待核查');
    expect(html).toContain('日期待更新');
    expect(html).toContain('2026-10-02');
    expect(html).toContain('数据不足');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('0.00');
  });
});
