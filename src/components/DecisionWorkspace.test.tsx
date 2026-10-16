import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DecisionWorkspace } from './DecisionWorkspace';
import { quantAnalysisFixture } from '../testFixtures/quantAnalysis';
import type { Holding, QuantAnalysisSnapshot, QuantMaSlopeSnapshot } from '../types';

describe('DecisionWorkspace', () => {
  it('keeps negative drawdowns in the table without repeating historical explanations in the answer panel', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.symbols.NVDA = {
      available: true,
      historical_standard: { lookback_years: 5, average_drawdown_pct: 9.3945, median_drawdown_pct: 6.2099, sample_count: 8, sample_status: 'direct' },
      execution_standard: { basis_symbol: 'NVDA', threshold_pct: 6.2099, execution_allowed: true, source: 'period_median' },
      depth_window: { applicable: true, open: true, current_pct: 6.348068, current_price: 93.651932, high_price: 100, threshold_pct: 6.2099 },
    } as QuantAnalysisSnapshot['symbols'][string];
    const html = renderToStaticMarkup(<DecisionWorkspace snapshot={snapshot} />);
    const row = html.match(/<button[^>]*data-symbol="NVDA"[\s\S]*?<\/button>/)?.[0] ?? '';
    expect(row).toContain('class="drawdown-value is-negative">-6.35%');
    expect(snapshot.symbols.NVDA.depth_window!.current_pct).toBe(6.348068);
    const aside = html.match(/<aside[\s\S]*?<\/aside>/)?.[0] ?? '';
    expect(aside).not.toContain('近5年平均跌幅');
    expect(aside).not.toContain('较参考线深');
    expect(aside).not.toContain('回撤与目标价');
  });

  it('retains held tags, trend values and an independent Z signal in the same row', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.growth_watchlist = { active_symbols: ['NVDA'], unresolved: [] };
    snapshot.symbols.NVDA = { available: true, ma_slope: {
      available: true, annualized_pct: -6.3, as_of: '2026-09-15',
      dashboard: { range: '5y', slope_window_sessions: 8, ma_periods: [20, 50, 200], slope_unit: 'pct_per_day', series: [], channel_alert: { available: true, as_of: '2026-09-15', state: 'neutral', signal: 'neutral', label: '中性', z_score: 0.98, complete_close: true, decision_use: false, buy_veto: false, reason: 'test' } },
    } as unknown as QuantMaSlopeSnapshot };
    const html = renderToStaticMarkup(<DecisionWorkspace snapshot={snapshot} holdings={[{ symbol: 'NVDA', name: '英伟达', shares: 10, assetType: 'stock' } as Holding]} />);
    const row = html.match(/<button[^>]*data-symbol="NVDA"[\s\S]*?<\/button>/)?.[0] ?? '';
    expect(row).toContain('已持仓');
    expect(row).toContain('-6.30%');
    expect(row).toContain('+0.98');
    expect(row).toContain('卖出观察');
    expect(row).toContain('signal-sell_near');
    expect(html).toContain('标准差动能筛选');
    expect(html).toContain('SMA 短线 / 趋势');
    expect(html).toContain('PE 历史位置');
    expect(html).toContain('20DMA');
    expect(html).toContain('8日回看');
    expect(html).toContain('NVDA · TTM PE 历史暂不可用');
    expect(html).toContain('买入观察区');
    expect(html).toContain('卖出观察区');
    expect(html).toContain('负值归入买入观察');
    const aside = html.match(/<aside[\s\S]*?<\/aside>/)?.[0] ?? '';
    expect(aside).toContain('盘中预览');
    expect(aside).toContain('+0.98');
    expect(aside).toContain('-6.30%');
    expect(aside).not.toContain('overheat-evidence');
    expect(aside).not.toContain('data-testid="sma-position"');
    expect(aside).not.toContain('data-testid="pe-position"');
    expect(aside).not.toContain('decision-z-detail');
    expect(html).not.toContain('trend-risk-warning');
    expect(html).not.toContain('示例数据');
    expect(html).not.toContain('data-testid="technical-symbol-list"');
    expect(html).toContain('data-favorite="DIA"');
    expect(html).toContain('data-favorite="VOO"');
    expect(html.indexOf('data-favorite="VOO"')).toBeLessThan(html.indexOf('data-favorite="AAPL"'));
    expect(html.indexOf('股票与指数斜率曲线')).toBeGreaterThan(html.indexOf('股票与指数决策'));
    expect(html.indexOf('股票与指数估值')).toBeGreaterThan(html.indexOf('股票与指数斜率曲线'));
  });

  it('keeps the complete indicator table and a direct answer panel without explanatory accordions', () => {
    const snapshot = structuredClone(quantAnalysisFixture) as unknown as QuantAnalysisSnapshot;
    snapshot.growth_watchlist = { active_symbols: ['NVDA'], unresolved: [] };
    const html = renderToStaticMarkup(<DecisionWorkspace snapshot={snapshot} />);
    expect(html).toContain('decision-view-indicators');
    expect(html).not.toContain('decision-view-simple');
    expect(html).not.toContain('决策显示模式');
    expect(html).not.toContain('简洁模式');
    expect(html).not.toContain('指标模式');
    const row = html.match(/<button[^>]*data-symbol="NVDA"[\s\S]*?<\/button>/)?.[0] ?? '';
    expect(row).toContain('sma-position');
    expect(row).toContain('pe-position');
    expect(row).toContain('decision-z');
    const aside = html.match(/<aside[\s\S]*?<\/aside>/)?.[0] ?? '';
    expect(aside.indexOf('当前结论')).toBeLessThan(aside.indexOf('盘中预览'));
    expect(aside).toContain('待核查'); // Old data must not become reassurance.
    for (const removed of ['主要原因', '为什么', '下一步关注', '买卖裁决依据', '回撤与目标价', 'SMA 斜率与双向统计', 'PE 历史位置与参考值', '统计口径', '露头记录', '最近提醒', '<details']) {
      expect(aside).not.toContain(removed);
    }
    expect(html).not.toContain('trend-risk-warning');
  });
});
