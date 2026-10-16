import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { QuantAnalysisSnapshot } from '../types';
import { MaSlopeExplorer } from './MaSlopeExplorer';
import maSlopeSource from './MaSlopeExplorer.tsx?raw';

function snapshot(): QuantAnalysisSnapshot {
  return {
    source: 'futu-assistant', generated_at: '2026-08-20T09:16:00-04:00',
    rule_version: '2.2', disclaimer: 'test', context: {},
    growth_watchlist: { active_symbols: ['NVDA', 'AVGO'], unresolved: [] },
    symbols: {
      NVDA: { available: true, ma_slope: {
        available: true, model: 'ma200_20d_annualized', role: 'trend_context_only',
        buy_veto: false, ma_period: 200, change_window_sessions: 20,
        annualization_sessions: 252, annualized_pct: 18.25,
        current_ma: 180.1, comparison_ma: 177.5, direction: 'up',
        regime: 'strong_up', label: '强势上涨', as_of: '2026-08-20',
        price_adjustment: 'QFQ', data_source: 'Futu OpenD closed daily bars',
        formula: '(MA200_t / MA200_t-20 - 1) × 252 / 20 × 100', reason: '趋势向上',
        series: [
          { date: '2026-08-18', annualized_pct: 17.9 },
          { date: '2026-08-19', annualized_pct: 18.25 },
        ],
        dashboard: {
          range: '5y', slope_window_sessions: 8, slope_unit: 'pct_per_day',
          ma_periods: [20, 50, 200], band_sigma: 1.5, z_score_period: 200,
          latest_bar_status: 'intraday', latest_closed_as_of: '2026-08-19',
          channel_alert: {
            available: true, state: 'buy', signal: 'buy', label: '可以买',
            as_of: '2026-08-19', close: 186, lower_band: 190, upper_band: 230,
            z_score: -1.6, near_sigma: 1.25, boundary_sigma: 1.5,
            complete_close: true, decision_use: false, buy_veto: false,
            reason: '完整收盘价已经跌破通道下轨，进入白色区域和买入阶段。',
          },
          summary: {
            price: 186, ma200: 161, distance_to_ma200_pct: 15.53,
            z_score: 0.82, z_score_band: '0.5 至 1.0', z_score_label: '中性',
            ma200_slope_annualized_pct: 12.6, ma200_trend: 'strong_up',
            ma200_trend_label: '强势上涨',
          },
          series: [
            { date: '2026-08-18', open: 180, high: 184, low: 179, close: 183, volume: 1000, ma20: 178, ma50: 172, ma200: 160, slope20: 0.22, slope50: 0.12, slope200: 0.04, std200: 25, band200: [122.5, 197.5], zscore200: 0.92 },
            { date: '2026-08-19', open: 183, high: 187, low: 182, close: 186, volume: 1200, ma20: 179, ma50: 173, ma200: 161, slope20: 0.24, slope50: 0.13, slope200: 0.05, std200: 30.49, band200: [115.265, 206.735], zscore200: 0.82, is_partial: false },
            { date: '2026-08-20', open: 186, high: 191, low: 185, close: 190, volume: 600, ma20: 180, ma50: 174, ma200: 162, slope20: 0.25, slope50: 0.14, slope200: 0.06, std200: 31.1, band200: [115.35, 208.65], zscore200: 0.9, is_partial: true },
          ],
        },
      } },
      AVGO: { available: true },
    },
  } as unknown as QuantAnalysisSnapshot;
}

describe('MaSlopeExplorer', () => {
  it('renders below valuation as a clickable and searchable standalone tool', () => {
    const html = renderToStaticMarkup(<MaSlopeExplorer snapshot={snapshot()} />);

    expect(html).toContain('股票与指数斜率');
    expect(html).toContain('输入股票代码');
    expect(html).toContain('查询曲线');
    expect(html).toContain('联动日期');
    expect(html).toContain('回到最新');
    expect(html).toContain('通道提醒筛选');
    expect(html).toContain('已持仓');
    expect(html).toContain('接近买');
    expect(html.match(/data-linked-chart="true"/g)).toHaveLength(4);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('每天美东 16:20');
    expect(html).toContain('绿色＝买入区');
    expect(html).toContain('红色＝卖出区');
    expect(html).toContain('data-channel-state="buy"');
    expect(html).toContain('bg-emerald-600');
    expect(html).toContain('可以买');
    expect(html).toContain('data-testid="channel-alert-card"');
    expect(html).toContain('进入白色区域和买入阶段');
    expect(html).toContain('股价与移动均线');
    expect(html).toContain('20DMA');
    expect(html).toContain('50DMA');
    expect(html).toContain('200DMA');
    expect(html).toContain('SMA 斜率曲线（%/天，8日回看）');
    expect(html).toContain('200 DMA / 距离');
    expect(html).toContain('Z-Score / 状态');
    expect(html).toContain('200 DMA 年化斜率 / 趋势');
    expect(html).toContain('Z-Score 区间');
    expect(html).toContain('±1.5σ 通道');
    expect(html).toContain('标准差动能图（Z-Score vs 200DMA）');
    expect(html).toContain('最新 2026-08-20（盘中）');
    expect(html).toContain('最新完整收盘 2026-08-19');
    expect(html).toContain('20DMA +0.250%/天');
    expect(html).toContain('Z-Score +0.900');
    expect(html).toContain('data-testid="latest-slope-values"');
    expect(html).toContain('data-testid="z-score-section"');
    expect(html).toContain('data-testid="volume-section"');
    expect(html).toContain('data-testid="slope-section"');
    expect(html.indexOf('data-testid="z-score-section"'))
      .toBeLessThan(html.indexOf('data-testid="volume-section"'));
    expect(html).toContain('显示成交量');
    expect(html).toContain('对数价格轴');
    expect(html).not.toContain('绿柱向上，红柱向下');
    expect(html).toContain('不进入买入裁决');
  });

  it('查询失败时保留上一份完整数据，并自动重试一次', () => {
    expect(maSlopeSource).toContain('withSingleRetry');
    expect(maSlopeSource).not.toContain('setResult(null)');
  });

  it('还有上一份完整数据时优先显示图表，没有旧数据才显示错误态', () => {
    expect(maSlopeSource).not.toContain('{error ? <ErrorState');
    expect(maSlopeSource).toContain(') : error ? <ErrorState message={error} /> : <LoadingState />}');
    expect(maSlopeSource).toContain('result.dashboard.slope_window_sessions === slopeWindow');
  });
});
