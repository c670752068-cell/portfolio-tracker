import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JournalPageView } from './JournalPage';
import type { DecisionLog } from '../decisionLog';
import type { AlertLogEntry } from '../alertLog';
import type { ExchangeRates } from '../types';

const rates: ExchangeRates = { USD: 1, CNY: 7, HKD: 7.8, JPY: 155, EUR: 0.92, GBP: 0.79, updatedAt: null, source: 'live' };
const log: DecisionLog = {
  version: 1, revision: 1, updated_at: null, trades_from: null, trades: [], nav_series: [], cash_flows: [],
};

function alert(overrides: Partial<AlertLogEntry> = {}): AlertLogEntry {
  return {
    id: 'alert-1',
    occurred_at: '2026-10-16T08:05:12.000Z',
    category: 'drawdown',
    symbol: 'QQQ',
    icon: '📉',
    text: 'QQQ 回撤 -5.02%（前高 759.66 → 收盘 721.53）· 本轮首次跌破 -5%',
    value: -5.02,
    threshold: -5,
    pushed: true,
    backfilled: false,
    session: 'closed',
    indicators: null,
    ...overrides,
  };
}

const render = (props: Partial<Parameters<typeof JournalPageView>[0]> = {}) => renderToStaticMarkup(
  <JournalPageView
    tab="alerts"
    onTabChange={() => {}}
    alerts={[]}
    hiddenAlertIds={[]}
    onToggleHidden={() => {}}
    showHidden
    categoryFilter="all"
    onCategoryFilterChange={() => {}}
    log={log}
    qqqSeries={[]}
    sgovSeries={[]}
    displayCurrency="USD"
    rates={rates}
    {...props}
  />,
);

describe('日志页框架', () => {
  it('标题、三个分页按钮和「隐藏已读」按钮都在，默认停在提醒日志', () => {
    const html = render();

    expect(html).toContain('日志');
    expect(html).toContain('提醒、决策与收益');
    expect(html).toContain('提醒日志');
    expect(html).toContain('决策日志');
    expect(html).toContain('收益对比');
    expect(html).toContain('隐藏已读');
    expect(html).toContain('aria-pressed="true"');
    // 选中的分页是绿底
    const selected = html.slice(html.indexOf('data-journal-tab="alerts"'), html.indexOf('data-journal-tab="decisions"'));
    expect(selected).toContain('bg-gain');
  });

  it('提醒日志是深色面板 + 等宽字体，最新的一条在最上面', () => {
    const html = render({
      alerts: [
        alert({ id: 'a1', occurred_at: '2026-10-16T08:05:12.000Z', text: '较早的一条' }),
        alert({ id: 'a2', occurred_at: '2026-10-17T08:05:08.000Z', text: '最新的一条' }),
      ],
    });

    expect(html).toContain('data-alert-log-panel="true"');
    expect(html).toContain('font-mono');
    expect(html).toContain('bg-black');
    expect(html.indexOf('最新的一条')).toBeLessThan(html.indexOf('较早的一条'));
    expect(html).toContain('已推送');
  });

  it('时间显示北京时间，标题属性里给美东时间', () => {
    const html = render({ alerts: [alert()] });

    // 2026-10-16T08:05:12Z = 北京 16:05:12 / 美东 04:05:12
    expect(html).toContain('10-16 16:05:12');
    expect(html).toContain('04:05:12');
  });

  it('回填的条目标「回填」，没推送的标「未推送」', () => {
    const html = render({
      alerts: [alert({ id: 'b1', backfilled: true, pushed: false, text: '回填的一条' })],
    });

    expect(html).toContain('回填');
    expect(html).not.toContain('已推送');
  });

  it('筛选按钮齐全', () => {
    const html = render();

    for (const label of ['全部', '回撤', '情绪', '估值', 'Z-Score', '卖出线', '仓位', '系统']) {
      expect(html).toContain(label);
    }
  });

  it('隐藏已读时不渲染被隐藏的条目，但不影响其他条目', () => {
    const html = render({
      alerts: [alert({ id: 'a1', text: '要隐藏的' }), alert({ id: 'a2', text: '要留下的' })],
      hiddenAlertIds: ['a1'],
      showHidden: false,
    });

    expect(html).not.toContain('要隐藏的');
    expect(html).toContain('要留下的');
  });

  it('切到决策日志和收益对比时才渲染对应内容', () => {
    const alerts = render();
    expect(alerts).not.toContain('命中率统计');
    expect(alerts).not.toContain('时间加权收益率');

    const decisions = render({ tab: 'decisions' });
    expect(decisions).toContain('命中率统计');
    expect(decisions).toContain('交易记录');

    const returns = render({ tab: 'returns' });
    expect(returns).toContain('时间加权收益率');
    expect(returns).toContain('同期满仓 QQQ');
  });

  it('没有提醒时给出空状态', () => {
    expect(render()).toContain('还没有记录');
  });
});
