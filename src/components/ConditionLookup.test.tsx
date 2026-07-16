import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { quantAnalysisFixture } from '../testFixtures/quantAnalysis';
import { ConditionLookup } from './ConditionLookup';

describe('ConditionLookup', () => {
  it('uses a locked snapshot-symbol select and filters cash equivalents', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).toContain('<select');
    expect(html).toContain('value="AAPL"');
    expect(html).toContain('value="SOXL"');
    expect(html).not.toContain('value="SGOV"');
    expect(html).not.toContain('placeholder="例如 SOXL"');
    expect(html).not.toContain('>查询</button>');
  });

  it('renders an ETF market group as X/3 and removes daily fuse from display', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).toContain('市场条件满足 1/3');
    expect(html).toContain('低位区');
    expect(html).toContain('买入信号');
    expect(html).toContain('估值/情绪');
    expect(html).not.toContain('当日熔断');
  });

  it('renders a stock market group as X/2 and keeps drawdown as reference only', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="AAPL" />,
    );

    expect(html).toContain('市场条件满足 1/2');
    expect(html).toContain('价格回撤参考');
    expect(html).not.toContain('✓ 低位区');
    expect(html).toContain('CNN 29.00（&lt;30 恐慌开窗）');
  });

  it('collapses position and batch into an integer-formatted discipline group', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).toContain('<details');
    expect(html).toContain('纪律闸门（决定允许买多少），不是行情判断');
    expect(html).toContain('第 2 批 / 共 3 批');
    expect(html).not.toContain('2.00');
    expect(html).not.toContain('3.00 批');
    expect(html).toContain('CNN 46.30');
    expect(html).toContain('纳指100 PE 分位 83.10%');
    expect(html).toContain('SOXX 分位 98.70%');
    expect(html).toContain('个股 PE 分位 暂无');
  });

  it('shows the exact snapshot age when quant data is stale', () => {
    const snapshot = {
      ...quantAnalysisFixture,
      generated_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    };
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={snapshot} initialSymbol="SOXL" />,
    );

    expect(html).toContain('量化分析数据 25 小时前，可能过期');
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

  it('shows the mandatory warning for an insufficient drawdown-depth sample', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).toContain('回撤深度 60%');
    expect(html).toContain('样本不足，勿下结论（n=10）');
    expect(html).toContain('含熊市样本：是');
  });

  it('shows the 60-day win rate for a conclusive drawdown-depth sample', () => {
    const snapshot = {
      ...quantAnalysisFixture,
      symbols: {
        ...quantAnalysisFixture.symbols,
        SOXL: {
          ...quantAnalysisFixture.symbols.SOXL,
          depth_stats: {
            level_pct: 60,
            win_rate_60d: 0.68,
            n: 25,
            sample_insufficient: false,
            bear_included: true,
          },
        },
      },
    };
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={snapshot} initialSymbol="SOXL" />,
    );

    expect(html).toContain('回撤深度 60%');
    expect(html).toContain('60 日历史成功率 68.0%（n=25）');
    expect(html).toContain('含熊市样本：是');
  });

});
