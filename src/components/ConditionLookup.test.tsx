import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { quantAnalysisFixture } from '../testFixtures/quantAnalysis';
import { ConditionLookup } from './ConditionLookup';

describe('ConditionLookup', () => {
  it('renders all six production gates and the passed-gate summary', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).toContain('低位区');
    expect(html).toContain('买入信号');
    expect(html).toContain('仓位门');
    expect(html).toContain('当日熔断');
    expect(html).toContain('批次');
    expect(html).toContain('估值/情绪');
    expect(html).toContain('当前满足 4/6 关');
  });

  it('shows the mandatory warning instead of a win rate for samples below 20', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).toContain('5 日');
    expect(html).toContain('样本不足，勿下结论');
    expect(html).toContain('n=19');
    expect(html).toContain('20 日');
    expect(html).toContain('55');
    expect(html).toContain('历史统计不代表未来收益');
  });

  it('gives a friendly answer and lists the pool for an unmonitored symbol', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="AAPL" />,
    );

    expect(html).toContain('AAPL 不在量化监控池');
    expect(html).toContain('池内代码');
    expect(html).toContain('SOXL');
  });
});
