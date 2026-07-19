import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { quantAnalysisFixture } from '../testFixtures/quantAnalysis';
import { ConditionLookup } from './ConditionLookup';

const holdings = [
  { id: 'msft', symbol: 'MSFT', name: '微软', shares: 10, buyPrice: 300, currentPrice: 400, sector: '科技', currency: 'USD' as const, assetType: 'stock' as const, broker: 'IBKR' },
  { id: 'msfu-option', symbol: 'MSFU CALL', name: 'MSFU Call', shares: 2, buyPrice: 2, currentPrice: 3, sector: '科技', currency: 'USD' as const, assetType: 'option' as const, broker: 'FUTU', option: { underlying: 'MSFU', optionType: 'call' as const, strike: 30, expiration: '2027-01-15', contractMultiplier: 100, delta: 0.4, theta: null, gamma: null, vega: null, impliedVolatility: null, underlyingPrice: 25 } },
  { id: 'tqqq', symbol: 'TQQQ', name: 'TQQQ', shares: 10, buyPrice: 50, currentPrice: 60, sector: 'ETF', currency: 'USD' as const, assetType: 'leveraged_etf' as const, broker: 'LONGPORT' },
  { id: 'sgov', symbol: 'SGOV', name: '现金类', shares: 10, buyPrice: 100, currentPrice: 100, sector: '现金', currency: 'USD' as const, assetType: 'etf' as const, broker: 'IBKR', cashEquivalent: true },
];

afterEach(() => vi.useRealTimers());

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

  it('adds server-summary status dots to both existing selectors', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} holdings={holdings} initialSymbol="SOXL" />,
    );

    expect(html).toContain('🟢 SOXL · 可买');
    expect(html).toContain('🟡 AMZN · 接近');
    expect(html).toContain('🔴 MSFT');
    expect(html).toContain('· 可卖</option>');
    expect(html).toContain('⚪ AAPL · 无');
  });

  it('shows successful refresh feedback with the snapshot timestamp and minute age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T14:12:59.000Z'));

    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} onRefresh={() => undefined} />,
    );

    expect(html).toContain('快照 2026-07-15 10:00 ET，12 分钟前');
  });

  it('removes the production signal row while keeping the 3x depth and macro conditions', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).toContain('市场条件满足 1/2');
    expect(html).toContain('低位区');
    expect(html).not.toContain('买入信号');
    expect(html).toContain('估值/情绪');
    expect(html).not.toContain('当日熔断');
  });

  it('renders the server-authored panic status above an applicable 3x symbol card', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html.indexOf('恐慌抢买窗口')).toBeLessThan(html.indexOf('SOXL 买入条件'));
    expect(html).toContain('疯狂提醒中');
    expect(html).toContain('深度位 ✓');
    expect(html).toContain('恐慌位 ✓');
    expect(html).toContain('目标 20% / 当前 3.2%');
    expect(html).toContain('value="16"');
  });

  it('does not render a panic status for a symbol absent from the backend block', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="AAPL" />,
    );

    expect(html).not.toContain('恐慌抢买窗口');
  });

  it('renders stock own-depth first and removes CNN SOXX and NDX from its card', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="AAPL" />,
    );

    expect(html).toContain('深度买入窗口（个股）');
    expect(html).toContain('深度位 ✓');
    expect(html).toContain('当前回撤</span><strong class="text-2xl">22.50%');
    expect(html).toContain('阈值</span><strong class="text-2xl">21.70%');
    expect(html).toContain('60 日胜率 68.00%');
    expect(html).toContain('（n=25）');
    expect(html).toContain('个股 PE 分位 45.00%');
    expect(html).not.toContain('CNN 29.00');
    expect(html).not.toContain('SOXX');
    expect(html).not.toContain('纳指100');
  });

  it('renders backend-authored ready and near depth highlights without recomputing thresholds', () => {
    const ready = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="AAPL" />,
    );
    const near = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="AMZN" />,
    );

    expect(ready).toContain('✓ 已达标');
    expect(ready).toContain('当前回撤</span><strong class="text-2xl">22.50%');
    expect(ready).toContain('阈值</span><strong class="text-2xl">21.70%');
    expect(ready).toContain('value="100"');
    expect(ready).toContain('60 日胜率 68.00%');
    expect(near).toContain('接近 · 还差 2.30 点');
    expect(near).toContain('value="86.857143"');
  });

  it('renders far and insufficient states honestly in both themes', () => {
    const snapshot = {
      ...quantAnalysisFixture,
      summary: {
        ...quantAnalysisFixture.summary,
        depth_states: {
          ...quantAnalysisFixture.summary.depth_states,
          AMZN: { status: 'far' as const, gap_pct: 8, excess_pct: 0, progress_pct: 55.55 },
        },
      },
    };
    const far = renderToStaticMarkup(
      <ConditionLookup snapshot={snapshot} initialSymbol="AMZN" />,
    );
    const insufficient = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(far).toContain('未达标');
    expect(far).toContain('value="55.55"');
    expect(far).toContain('dark:');
    expect(insufficient).toContain('60 日样本不足（n=18）');
    expect(insufficient).toContain('text-slate-400');
    expect(insufficient).toContain('min-w-0');
    expect(insufficient).toContain('overflow-hidden');
  });

  it('highlights the panic result and names its trigger session', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} initialSymbol="SOXL" />,
    );

    expect(html).toContain('恐慌位 ✓ 已触发');
    expect(html).toContain('触发时段：盘中');
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
    expect(html).toContain('55.00%');
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
    expect(html).toContain('60 日历史成功率 68.00%（n=25）');
    expect(html).toContain('含熊市样本：是');
  });

  it('renders a held-only sell selector and the server-authored repair window', () => {
    const html = renderToStaticMarkup(
      <ConditionLookup snapshot={quantAnalysisFixture} holdings={holdings} initialSymbol="AAPL" />,
    );

    expect(html).toContain('aria-label="卖出持仓标的"');
    expect(html).toContain('value="MSFT"');
    expect(html).toContain('value="MSFU"');
    expect(html).toContain('value="TQQQ"');
    expect(html).not.toContain('value="SGOV"');
    expect(html).toContain('卖出窗口未开启：深跌修复期内，耐心持有（基准日 2026-03-30）');
    expect(html).toContain('建议至少减仓 50%');
    expect(html).toContain('市场亢奋·清仓杠杆品种或调仓 SGOV');
    expect(html).toContain('（观察期，未正式生效）');
    expect(html).toContain('5日涨幅过热 2026-07-15');
    expect(html).toContain('只提醒不下单；由你在券商 App 手动执行。');
  });

});
