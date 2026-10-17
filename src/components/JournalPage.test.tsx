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

describe('日志页自动刷新', () => {
  const live = (overrides: Partial<Parameters<typeof JournalPageView>[0]> = {}) => render({
    alerts: [alert({ id: 'a1', text: '旧的一条' }), alert({ id: 'a2', occurred_at: '2026-10-17T08:00:00.000Z', text: '刚进来的一条' })],
    ...overrides,
  });

  it('面板上有实时状态和上次更新时间', () => {
    const html = live({ liveStatus: 'live', secondsSinceUpdate: 12 });

    expect(html).toContain('实时');
    expect(html).toContain('12 秒前');
  });

  it('断开时显示正在重连', () => {
    const html = live({ liveStatus: 'disconnected', secondsSinceUpdate: 95 });

    expect(html).toContain('已断开');
    expect(html).toContain('正在重连');
  });

  it('新进来的那一行会高亮', () => {
    const html = live({ highlightedIds: ['a2'] });
    const row = html.slice(html.indexOf('刚进来的一条') - 400, html.indexOf('刚进来的一条'));

    expect(row).toContain('alert-row-new');
  });

  it('「只看重要」只留下重要提醒', () => {
    const html = render({
      alerts: [
        alert({ id: 'i1', text: '重要的一条', indicators: { level: 1 } }),
        alert({ id: 'n1', text: '普通的一条', indicators: { level: 2 } }),
      ],
      importantOnly: true,
    });

    expect(html).toContain('重要的一条');
    expect(html).not.toContain('普通的一条');
    expect(html).toContain('只看重要');
  });
});

describe('推送状态和作废标记', () => {
  it('被免打扰拦下的标「[免打扰]」', () => {
    const html = render({ alerts: [alert({ pushed: false, push_state: 'quiet_hours' })] });
    expect(html).toContain('[免打扰]');
    expect(html).not.toContain('[未推送]');
  });

  it('发出去的标「[已推送]」，连发多条带次数', () => {
    expect(render({ alerts: [alert({ pushed: true, push_state: 'sent' })] })).toContain('[已推送]');
    expect(render({ alerts: [alert({ pushed: true, push_state: 'sent', push_repeat: 3 })] })).toContain('[已推送 ×3]');
  });

  it('类别开关没开时说清为什么没推送', () => {
    const html = render({ alerts: [alert({ pushed: false, push_state: 'category_disabled' })] });
    expect(html).toContain('[未推送 · 类别开关未开]');
  });

  it('已作废的那条带「[已作废]」并划掉，但还在列表里', () => {
    const html = render({
      alerts: [alert({ text: 'TSLA $353.18 ≥ 卖出线 $31.41', voided: true, voided_reason: '卖出线未过合理性校验' })],
    });
    expect(html).toContain('[已作废]');
    expect(html).toContain('line-through');
    expect(html).toContain('TSLA $353.18 ≥ 卖出线 $31.41');
  });
});

describe('只有一天净值时的收益对比', () => {
  const oneDay: DecisionLog = {
    ...log,
    nav_series: [{ date: '2026-10-16', nav: 186325.01, captured_at: '2026-10-16T17:15:08.631Z' }],
  };
  const qqq = [
    { date: '2026-10-15', close: 728 },
    { date: '2026-10-16', close: 709.8 },
  ];

  it('显示起始日期，但基准区间长度为零时一律显示暂无', () => {
    const html = render({ tab: 'returns', log: oneDay, qqqSeries: qqq, sgovSeries: qqq });

    expect(html).toContain('净值序列从 2026-10-16 开始');
    expect(html).not.toContain('0.00% / 0.00%');
  });
});

describe('基准收益算不出时最大回撤也不显示数字', () => {
  it('同期收益是暂无时，对应的最大回撤也是暂无', () => {
    const navs: DecisionLog = {
      ...log,
      nav_series: [
        { date: '2026-10-16', nav: 100_000, captured_at: 'x' },
        { date: '2026-10-19', nav: 110_000, captured_at: 'y' },
      ],
    };
    // 区间里只有一根基准 K 线：收益算不出来（没有两端），但回撤会算成 0.00%
    const single = [{ date: '2026-10-17', close: 700 }];
    const html = render({ tab: 'returns', log: navs, qqqSeries: single, sgovSeries: single });

    expect(html).toContain('暂无 / 暂无');
    expect(html).not.toContain('0.00% / 0.00%');
  });

  it('净值样本天数只数能用的那几天，缺失的不算', () => {
    const navs: DecisionLog = {
      ...log,
      nav_series: [
        { date: '2026-10-16', nav: 100_000, captured_at: 'x' },
        { date: '2026-10-19', nav: null as unknown as number, missing: true, captured_at: null },
        { date: '2026-10-20', nav: 110_000, captured_at: 'y' },
      ],
    };
    const html = render({ tab: 'returns', log: navs });

    expect(html).toContain('2 天');
    expect(html).not.toContain('3 天');
  });
});

describe('推送失败和重试中的标记', () => {
  it('彻底失败标「[推送失败]」', () => {
    expect(render({ alerts: [alert({ pushed: false, push_state: 'failed' })] })).toContain('[推送失败]');
  });

  it('还在重试的标「[重试中]」', () => {
    expect(render({ alerts: [alert({ pushed: false, push_state: 'pending_retry' })] })).toContain('[重试中]');
  });
});
