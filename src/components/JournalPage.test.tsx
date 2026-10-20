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
    const start = html.indexOf('data-alert-row="a2"');
    const row = html.slice(start, start + 200);

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
  // 手机上一条只占一行，推送状态改成行尾小图标，原因文字放在悬停/长按的提示里
  it('被免打扰拦下的显示 🌙，提示写「免打扰」', () => {
    const html = render({ alerts: [alert({ pushed: false, push_state: 'quiet_hours' })] });
    expect(html).toContain('🌙');
    expect(html).toContain('推送状态：免打扰');
  });

  it('发出去的显示 📲，连发多条在提示里带次数', () => {
    expect(render({ alerts: [alert({ pushed: true, push_state: 'sent' })] })).toContain('📲');
    expect(render({ alerts: [alert({ pushed: true, push_state: 'sent', push_repeat: 3 })] }))
      .toContain('推送状态：已推送 ×3');
  });

  it('类别开关没开时显示 🔕，提示说清为什么没推送', () => {
    const html = render({ alerts: [alert({ pushed: false, push_state: 'category_disabled' })] });
    expect(html).toContain('🔕');
    expect(html).toContain('推送状态：未推送 · 类别开关未开');
  });

  it('已作废的那条带「[已作废 · 原因]」并划掉，但还在列表里', () => {
    const html = render({
      alerts: [alert({ text: 'TSLA $353.18 ≥ 卖出线 $31.41', voided: true, voided_reason: '卖出线未过合理性校验' })],
    });
    expect(html).toContain('[已作废 · 卖出线未过合理性校验]');
    expect(html).toContain('line-through');
    expect(html).toContain('TSLA $353.18 ≥ 卖出线 $31.41');
  });

  it('零碎持仓那几条标「已作废 · 零碎持仓」', () => {
    const html = render({
      alerts: [alert({
        category: 'position', symbol: 'NVDA', icon: '🧾',
        text: 'FUTU · 买入 NVDA 0.005 @ $216.00 · 已同步到决策日志，待补充理由',
        voided: true, voided_reason: '零碎持仓',
      })],
    });
    expect(html).toContain('[已作废 · 零碎持仓]');
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
  it('彻底失败显示 ❌', () => {
    const html = render({ alerts: [alert({ pushed: false, push_state: 'failed' })] });
    expect(html).toContain('❌');
    expect(html).toContain('推送状态：推送失败');
  });

  it('还在重试的显示 ⏳', () => {
    const html = render({ alerts: [alert({ pushed: false, push_state: 'pending_retry' })] });
    expect(html).toContain('⏳');
    expect(html).toContain('推送状态：重试中');
  });
});

describe('手机上的提醒列表', () => {
  it('每条默认一行：时间只到分钟、正文截断、面板不横向滚动', () => {
    const html = render({
      alerts: [alert({
        id: 'z1', category: 'zscore', symbol: 'UDOW', icon: '🔴',
        occurred_at: '2026-10-20T13:38:55.000Z',
        text: '[盘中] UDOW $67.41 · Z 0.38 → 0.52 · 涨得更多，偏强',
        indicators: { level: 2 },
      })],
    });

    expect(html).toContain('>21:38<');
    expect(html).toContain('UDOW $67.41 Z 0.52 偏强');
    expect(html).toContain('truncate');
    expect(html).not.toContain('overflow-x-auto');
    // 完整说明要点开才出现
    expect(html).not.toContain('涨得更多，偏强');
  });

  it('重要提醒置顶，左边有颜色竖条', () => {
    const html = render({
      alerts: [
        alert({ id: 'n1', occurred_at: '2026-10-20T13:40:00.000Z', text: '普通的一条', indicators: { level: 2 } }),
        alert({
          id: 'i1', occurred_at: '2026-10-20T13:00:00.000Z', category: 'sell_line', symbol: 'NVDA', icon: '💰',
          text: '[盘中] NVDA $217.12 ≥ 卖出线 $210.00', indicators: { level: 1 },
        }),
      ],
      lastOpenedAt: '2026-10-20T00:00:00.000Z',
    });

    expect(html).toContain('置顶的重要提醒');
    expect(html).toContain('border-red-500');
    // 虽然时间更早，重要那条排在普通那条前面
    expect(html.indexOf('data-alert-row="i1"')).toBeLessThan(html.indexOf('data-alert-row="n1"'));
  });

  it('点过的重要提醒回到时间顺序', () => {
    const html = render({
      alerts: [
        alert({ id: 'n1', occurred_at: '2026-10-20T13:40:00.000Z', text: '普通的一条', indicators: { level: 2 } }),
        alert({ id: 'i1', occurred_at: '2026-10-20T13:00:00.000Z', text: '重要的一条', indicators: { level: 1 } }),
      ],
      readAlertIds: ['i1'],
      lastOpenedAt: '2026-10-20T00:00:00.000Z',
    });

    expect(html).not.toContain('置顶的重要提醒');
    expect(html.indexOf('data-alert-row="n1"')).toBeLessThan(html.indexOf('data-alert-row="i1"'));
  });

  it('未读数量和「以下是新提醒」分隔线', () => {
    const html = render({
      alerts: [
        alert({ id: 'new1', occurred_at: '2026-10-20T13:40:00.000Z', text: '新的一条', indicators: { level: 2 } }),
        alert({ id: 'old1', occurred_at: '2026-10-19T13:40:00.000Z', text: '旧的一条', indicators: { level: 2 } }),
      ],
      lastOpenedAt: '2026-10-20T00:00:00.000Z',
    });

    expect(html).toContain('未读 1');
    expect(html).toContain('—— 以下是新提醒 ——');
    expect(html.indexOf('—— 以下是新提醒 ——')).toBeLessThan(html.indexOf('data-alert-row="new1"'));
  });

  it('上次打开之后没有新提醒时不画分隔线', () => {
    const html = render({
      alerts: [alert({ id: 'old1', occurred_at: '2026-10-19T13:40:00.000Z', text: '旧的一条', indicators: { level: 2 } })],
      lastOpenedAt: '2026-10-20T00:00:00.000Z',
    });

    expect(html).not.toContain('以下是新提醒');
    expect(html).not.toContain('未读');
  });

  it('「仅记录」级别默认折叠，打开「显示全部」才出现', () => {
    const alerts = [
      alert({ id: 'l1', text: '只记录的一条', indicators: { level: 3 } }),
      alert({ id: 'n1', text: '普通的一条', indicators: { level: 2 } }),
    ];

    const folded = render({ alerts });
    expect(folded).not.toContain('只记录的一条');
    expect(folded).toContain('普通的一条');
    expect(folded).toContain('显示全部（仅记录 1）');

    const all = render({ alerts, showAllLevels: true });
    expect(all).toContain('只记录的一条');
  });

  it('汇总行默认只显示「N 个标的」，明细点开才看', () => {
    const html = render({
      alerts: [alert({
        id: 's1', category: 'valuation', symbol: null, icon: '📋',
        text: '[盘前] 估值汇总 · 5 个标的', indicators: { level: 3 },
        summary_items: [{ symbol: 'AVGO', text: '🟢 AVGO · 低估值 · $333.88' }],
      })],
      showAllLevels: true,
    });

    expect(html).toContain('估值汇总 5 个标的');
    expect(html).not.toContain('$333.88');
  });
});

