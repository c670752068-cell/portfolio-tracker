import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { quantAnalysisFixture } from '../testFixtures/quantAnalysis';
import type { QuantAnalysisSnapshot } from '../types';
import { CompactBuyDecisionSection } from './CompactBuyDecisionSection';

describe('CompactBuyDecisionSection', () => {
  it('shows only the unified drawdown-first buy answer', () => {
    const value = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    value.final_verdict = { symbols: { AMZN: {
      symbol: 'AMZN', verdict: 'NO_BUY', layers: [{
        layer: 'gates_six', state: 'passed', passed: true, reason: '估值已通过',
      }],
    } } };

    const html = renderToStaticMarkup(<CompactBuyDecisionSection snapshot={value} initialSymbol="AMZN" />);

    expect(html).toContain('data-testid="compact-buy-decision"');
    expect(html).toContain('暂时不买');
    expect(html).toContain('还需下跌 2.30 个百分点');
    expect(html).toContain('当前回撤 15.20%');
    expect(html).toContain('回撤线 17.50%');
    expect(html).toContain('只按回撤判断买入');
    expect(html).toContain('估值不参与买入判断');
    expect(html).toContain('均线仅作执行参考');
    expect(html).not.toContain('均线确认后执行');
    expect(html).not.toContain('仓位配比');
    expect(html).not.toContain('五层条件');
    expect(html).not.toContain('回撤历史');
    expect(html).not.toContain('仍需估值通过');
  });

  it('puts the deepest eligible drawdown first', () => {
    const value = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    value.symbols.AVGO = structuredClone(value.symbols.AMZN);
    value.symbols.AVGO.depth_window = {
      ...value.symbols.AVGO.depth_window!, current_pct: 28, threshold_pct: 14, open: true,
    };
    value.symbols.AMZN.depth_window = {
      ...value.symbols.AMZN.depth_window!, current_pct: 18, threshold_pct: 17.5, open: true,
    };
    value.growth_watchlist = { active_symbols: ['AMZN', 'AVGO'], unresolved: [] };
    value.final_verdict = { symbols: {
      AMZN: { symbol: 'AMZN', verdict: 'BUY' },
      AVGO: { symbol: 'AVGO', verdict: 'BUY' },
    } };

    const html = renderToStaticMarkup(<CompactBuyDecisionSection snapshot={value} />);
    const selected = html.match(/role="option" aria-selected="true"[^>]*>.*?<span[^>]*>([^<]+)/);

    expect(selected?.[1]).toBe('AVGO');
  });

  it('marks a 5–7 cycle execution standard as reference', () => {
    const value = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    value.symbols.AMZN.historical_standard = {
      sample_count: 7,
      sample_status: 'reference',
      median_drawdown_pct: 17.06,
      average_drawdown_pct: 15.46,
    };
    value.symbols.AMZN.execution_standard = {
      sample_count: 7,
      sample_status: 'reference',
      threshold_pct: 17.06,
      execution_allowed: true,
      basis_symbol: 'AMZN',
      source: 'reference_deeper_of_period_and_full_history',
    };

    const html = renderToStaticMarkup(<CompactBuyDecisionSection snapshot={value} initialSymbol="AMZN" />);

    expect(html).toContain('n=7 · 参考');
    expect(html).toContain('实际执行线（参考）');
    expect(html).toContain('回撤线 17.06%');
  });

  it('uses a non-zero limited-sample median while keeping the caution marker', () => {
    const value = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    value.symbols.AMZN.historical_standard = {
      sample_count: 4,
      sample_status: 'insufficient',
      median_drawdown_pct: 11.00,
      average_drawdown_pct: 13.00,
    };
    value.symbols.AMZN.execution_standard = {
      sample_count: 4,
      sample_status: 'insufficient',
      threshold_pct: 11.00,
      execution_allowed: true,
      basis_symbol: 'AMZN',
      source: 'period_median_limited_sample',
    };

    const html = renderToStaticMarkup(<CompactBuyDecisionSection snapshot={value} initialSymbol="AMZN" />);

    expect(html).toContain('n=4');
    expect(html).toContain('实际执行线（小样本参考）');
    expect(html).toContain('回撤线 11.00%');
    expect(html).not.toContain('样本不足，待判断');
  });

  it('defaults to TQQQ when the monitored list contains it', () => {
    const value = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    value.symbols.TQQQ = structuredClone(value.symbols.AMZN);
    value.growth_watchlist = { active_symbols: ['TQQQ', 'AMZN'], unresolved: [] };

    const html = renderToStaticMarkup(<CompactBuyDecisionSection snapshot={value} />);

    expect(html).toContain('aria-label="买入判定标的"');
    expect(html).toContain('<span class="font-semibold tabular-nums">TQQQ</span>');
  });

  it('shows the benchmark peak close and date used by the drawdown calculation', () => {
    const value = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    value.symbols.TQQQ = structuredClone(value.symbols.AMZN);
    value.symbols.TQQQ.depth_window = {
      ...value.symbols.TQQQ.depth_window!,
      current_price: 723.03,
      high_price: 745.3404,
      high_price_date: '2026-06-02',
      threshold_price: 663.35,
    };
    value.symbols.TQQQ.execution_standard = {
      basis_symbol: 'QQQ', threshold_pct: 10.8643, source: 'period_median',
      execution_allowed: true,
    };
    value.growth_watchlist = { active_symbols: ['TQQQ'], unresolved: [] };

    const html = renderToStaticMarkup(<CompactBuyDecisionSection snapshot={value} />);

    expect(html).toContain('计算高点 $745.34');
    expect(html).toContain('最高收盘价 · 2026-06-02');
    expect(html).toContain('回撤达标价 $664.36');
    expect(html).toContain('仅表示价格条件');
    expect(html).toContain('回撤越深，买入优先级越高');
    expect(html).not.toContain('买入参考价');
  });

  it('names GLD as the inherited history basis for GDX', () => {
    const value = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    value.symbols.GDX = structuredClone(value.symbols.AMZN);
    value.symbols.GDX.historical_standard = {
      basis_symbol: 'GLD', inherited: true, sample_count: 8, sample_status: 'direct',
      median_drawdown_pct: 9.1241, average_drawdown_pct: 12.1822,
    };
    value.symbols.GDX.execution_standard = {
      basis_symbol: 'GLD', threshold_pct: 9.1241, execution_allowed: true,
      source: 'special_calibration', sample_status: 'direct', sample_count: 8,
    };

    const html = renderToStaticMarkup(<CompactBuyDecisionSection snapshot={value} initialSymbol="GDX" />);

    expect(html).toContain('历史统计线（GLD · 2021–2026）');
  });

  it('shows the complete MA200 slope evidence without changing a drawdown buy', () => {
    const value = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    value.symbols.AVGO = structuredClone(value.symbols.AMZN);
    value.symbols.AVGO.depth_window = {
      ...value.symbols.AVGO.depth_window!, current_pct: 27.08, threshold_pct: 14.02, open: true,
    };
    value.symbols.AVGO.ma_slope = {
      available: true, model: 'ma200_20d_annualized', role: 'trend_context_only', buy_veto: false,
      ma_period: 200, change_window_sessions: 20, annualization_sessions: 252,
      annualized_pct: -12.34, current_ma: 390.25, comparison_ma: 409.31,
      direction: 'down', regime: 'strong_down', label: '强势下跌', as_of: '2026-08-19',
      price_adjustment: 'QFQ', data_source: 'Futu OpenD closed daily bars',
      formula: '(MA200_t / MA200_t-20 - 1) × 252 / 20 × 100',
      reason: '200日均线斜率为 -12.34%，属于强势下跌；仅作趋势风险说明，不否决回撤买点。',
    };
    value.final_verdict = { symbols: { AVGO: {
      symbol: 'AVGO', verdict: 'BUY', layers: [{
        layer: 'entry_gate_1x', state: 'passed', passed: true, reason: '回撤已达标',
      }],
    } } };
    value.growth_watchlist = { active_symbols: ['AVGO'], unresolved: [] };

    const html = renderToStaticMarkup(<CompactBuyDecisionSection snapshot={value} initialSymbol="AVGO" />);

    expect(html).toContain('可以买');
    expect(html).toContain('200日均线斜率');
    expect(html).toContain('-12.34% · 强势下跌');
    expect(html).toContain('当前200DMA $390.25 · 20日前 $409.31');
    expect(html).toContain('只作趋势风险说明，不参与“可以买/不买”否决；回撤仍优先');
  });

  it('renders Walmart from the Futu growth list as a drawdown-first buy', () => {
    const value = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    value.symbols.WMT = structuredClone(value.symbols.AMZN);
    value.symbols.WMT.depth_window = {
      ...value.symbols.WMT.depth_window!, current_pct: 22.90273, threshold_pct: 10,
      current_price: 104.01, high_price: 134.9075, open: true,
    };
    value.symbols.WMT.historical_standard = {
      basis_symbol: 'WMT', sample_count: 7, sample_status: 'reference',
      median_drawdown_pct: 14.4697, average_drawdown_pct: 16.9037,
    };
    value.symbols.WMT.execution_standard = {
      basis_symbol: 'WMT', threshold_pct: 10, execution_allowed: true,
      source: 'focused_60d_supported_depth', sample_status: 'reference', sample_count: 7,
    };
    value.growth_watchlist = { active_symbols: ['WMT'], unresolved: [] };
    value.final_verdict = { symbols: { WMT: {
      symbol: 'WMT', verdict: 'BUY', single_sentence: '回撤与风险条件已通过。',
    } } };

    const html = renderToStaticMarkup(
      <CompactBuyDecisionSection snapshot={value} initialSymbol="WMT" />,
    );

    expect(html).toContain('>WMT</span>');
    expect(html).toContain('可以买');
    expect(html).toContain('当前回撤 22.90%');
    expect(html).toContain('回撤线 10.00%');
    expect(html).toContain('中位 14.47% · 平均 16.90% · n=7 · 参考');
    expect(html).toContain('估值不参与买入判断');
  });
});
