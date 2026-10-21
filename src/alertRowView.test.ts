import { describe, expect, it } from 'vitest';
import type { AlertLogEntry } from './alertLog';
import {
  HEADLINE_MAX, alertAccent, alertHeadline, dayLabel, groupTimeline, isLogOnly, partitionAlerts,
  pushStateIcon, suggestedSide,
} from './alertRowView';

function entry(partial: Partial<AlertLogEntry>): AlertLogEntry {
  return {
    id: 'alert-1', occurred_at: '2026-10-20T13:38:55.000Z', category: 'zscore', symbol: 'UDOW',
    icon: '🔴', text: '测试', value: null, threshold: null, pushed: false, backfilled: false,
    session: 'regular', indicators: null, ...partial,
  } as AlertLogEntry;
}

describe('手机上每条提醒只占一行', () => {
  it('去掉时段标签，长段落压成关键数字', () => {
    expect(alertHeadline(entry({
      text: '[盘中] UDOW $67.41 · Z 0.38 → 0.52 · 涨得更多，偏强',
    }))).toBe('UDOW $67.41 · Z 0.52 · 偏强');
  });

  it('跌得更深那一条同样压成一行', () => {
    expect(alertHeadline(entry({
      icon: '🟢', symbol: 'GDX', text: '[盘中] GDX $85.66 · Z -0.45 → -0.53 · 跌得更深，偏弱',
    }))).toBe('GDX $85.66 · Z -0.53 · 偏弱');
  });

  it('估值推送那一条砍掉分号后面的操作说明', () => {
    expect(alertHeadline(entry({
      category: 'valuation', symbol: 'AVGO', icon: '🔔',
      text: '[盘前] 🟢 AVGO · 低估值 · $333.88 · 远期 PE 22.60；按计划分批买入或继续持有。',
    }))).toBe('🟢 AVGO · 低估值 · $333.88…');
  });

  it('再长也不会超过一行的字数上限', () => {
    const headline = alertHeadline(entry({
      text: '[盘中] 多指标共振：QQQ -6.2% · VIX +33% · CNN 18 · 以上按收盘价统计，今天还没收盘',
    }));
    expect(headline.length).toBeLessThanOrEqual(HEADLINE_MAX + 1);
    expect(headline.endsWith('…')).toBe(true);
  });

  it('带括号的回撤原文不被箭头规则切坏', () => {
    expect(alertHeadline(entry({
      category: 'drawdown', symbol: 'QQQ', icon: '📉',
      text: 'QQQ 回撤 -5.02%（前高 759.66 → 收盘 721.53）· 本轮首次跌破 -5%',
    }))).toBe('QQQ 回撤 -5.02% · 本轮首次跌破 -5%');
  });

  it('汇总行显示「N 个标的」，不显示明细', () => {
    expect(alertHeadline(entry({
      category: 'valuation', symbol: null, icon: '📋', text: '[盘前] 估值汇总 · 5 个标的',
    }))).toBe('估值汇总 · 5 个标的');
  });

  it('换行的长文只取第一行', () => {
    expect(alertHeadline(entry({ text: '[盘中] 多指标共振\n历史参考：2015 年以来共 21 次…' })))
      .not.toContain('历史参考');
  });
});

describe('推送状态用行尾小图标', () => {
  it.each([
    ['sent', '📲', '已推送'],
    ['quiet_hours', '🌙', '免打扰'],
    ['failed', '❌', '推送失败'],
    ['category_disabled', '🔕', '类别开关未开'],
    ['log_only', '🔕', '只记录不推送'],
  ])('%s 显示 %s', (state, icon, label) => {
    const view = pushStateIcon(entry({ push_state: state }));
    expect(view.icon).toBe(icon);
    expect(view.label).toContain(label);
  });

  it('老记录没有 push_state，就按 pushed 显示', () => {
    expect(pushStateIcon(entry({ pushed: true })).icon).toBe('📲');
    expect(pushStateIcon(entry({ pushed: false })).icon).toBe('🔕');
  });
});

describe('重要提醒的颜色竖条', () => {
  it('买入类绿、卖出类红、风险类橙', () => {
    expect(alertAccent(entry({ icon: '🟢', text: '[盘中] MU · Z -1.63 · 跌得更深，已进入买入区', indicators: { level: 1 } }))).toBe('buy');
    expect(alertAccent(entry({ category: 'drawdown', icon: '🔔', text: '[盘前] 🟢 NKE · 可买 · $62.10', indicators: { level: 1 } }))).toBe('buy');
    expect(alertAccent(entry({ category: 'sell_line', icon: '💰', text: '[盘中] NVDA $217 ≥ 卖出线 $210', indicators: { level: 1 } }))).toBe('sell');
    expect(alertAccent(entry({ icon: '🔴', text: '[盘中] NVDA · Z 1.52 · 涨得更多，进入卖出区', indicators: { level: 1 } }))).toBe('sell');
    expect(alertAccent(entry({ category: 'sentiment', icon: '⚡', text: '[盘中] VIX 28.4 · 升破 23', indicators: { level: 1 } }))).toBe('risk');
  });

  it('普通和仅记录的条目没有竖条', () => {
    expect(alertAccent(entry({ indicators: { level: 2 }, text: '[盘中] UDOW · Z 0.52 · 偏强' }))).toBeNull();
    expect(alertAccent(entry({ indicators: { level: 3 }, text: '[盘中] MU · 大涨' }))).toBeNull();
    expect(alertAccent(entry({ indicators: null, text: '[盘中] MU · 大涨' }))).toBeNull();
  });

  it('已作废的条目不置顶也不上色', () => {
    expect(alertAccent(entry({ indicators: { level: 1 }, voided: true, text: '买入 NVDA 0.005' }))).toBeNull();
  });
});

describe('仅记录级别默认折叠', () => {
  it('level 3 算仅记录，其他不算', () => {
    expect(isLogOnly(entry({ indicators: { level: 3 } }))).toBe(true);
    expect(isLogOnly(entry({ indicators: { level: 2 } }))).toBe(false);
    expect(isLogOnly(entry({ indicators: null }))).toBe(false);
  });
});

describe('置顶、未读与「以下是新提醒」分隔线', () => {
  const rows = [
    entry({ id: 'new-important', occurred_at: '2026-10-20T13:38:00.000Z', indicators: { level: 1 }, text: '[盘中] MU · 已进入买入区', icon: '🟢' }),
    entry({ id: 'new-normal', occurred_at: '2026-10-20T13:30:00.000Z', indicators: { level: 2 } }),
    entry({ id: 'old-important', occurred_at: '2026-10-19T13:30:00.000Z', indicators: { level: 1 } }),
    entry({ id: 'old-normal', occurred_at: '2026-10-19T12:00:00.000Z', indicators: { level: 2 } }),
  ];

  const AT = new Date('2026-10-20T13:45:00.000Z');

  it('未读的重要提醒置顶，读过的回到时间顺序', () => {
    const fresh = partitionAlerts(rows, { readIds: [], lastOpenedAt: '2026-10-20T00:00:00.000Z', now: AT });
    expect(fresh.pinned.map((item) => item.id)).toEqual(['new-important']);
    expect(fresh.timeline.map((item) => item.id)).toEqual(['new-normal', 'old-important', 'old-normal']);

    const read = partitionAlerts(rows, { readIds: ['new-important'], lastOpenedAt: '2026-10-20T00:00:00.000Z', now: AT });
    expect(read.pinned).toEqual([]);
    expect(read.timeline.map((item) => item.id)).toEqual(['new-important', 'new-normal', 'old-important', 'old-normal']);
  });

  it('未读数量按上次打开时间算', () => {
    expect(partitionAlerts(rows, { readIds: [], lastOpenedAt: '2026-10-20T00:00:00.000Z' }).unread).toBe(2);
    expect(partitionAlerts(rows, { readIds: [], lastOpenedAt: null }).unread).toBe(4);
    expect(partitionAlerts(rows, { readIds: [], lastOpenedAt: '2026-10-21T00:00:00.000Z' }).unread).toBe(0);
  });

  it('分隔线放在上次打开之后新增的最后一条下面', () => {
    const view = partitionAlerts(rows, { readIds: ['new-important'], lastOpenedAt: '2026-10-20T00:00:00.000Z', now: AT });
    // new-important、new-normal 是新的，分隔线在它们之后
    expect(view.newCount).toBe(2);
    expect(view.timeline.slice(0, view.newCount).map((item) => item.id)).toEqual(['new-important', 'new-normal']);
  });

  it('全是旧提醒时没有分隔线', () => {
    expect(partitionAlerts(rows, { readIds: [], lastOpenedAt: '2026-10-21T00:00:00.000Z' }).newCount).toBe(0);
  });
});

describe('「我据此下单了」的方向', () => {
  it('卖出线、红橙提醒按卖出，其余按买入', () => {
    expect(suggestedSide(entry({ category: 'sell_line', icon: '💰', text: 'NVDA ≥ 卖出线' }))).toBe('SELL');
    expect(suggestedSide(entry({ icon: '🔴', text: '[盘中] NVDA · Z 1.52 · 涨得更多' }))).toBe('SELL');
    expect(suggestedSide(entry({ icon: '🟢', text: '[盘中] MU · Z -1.63 · 跌得更深' }))).toBe('BUY');
    expect(suggestedSide(entry({ category: 'drawdown', icon: '📉', text: 'QQQ 回撤 -5%' }))).toBe('BUY');
  });
});

describe('单行摘要要保住标的和关键数字', () => {
  it('括号里的说明不留半个括号；括号前有数字就只留括号前', () => {
    expect(alertHeadline(entry({
      symbol: 'QQQ', text: 'QQQ 回到前高 · 本轮回撤结束（最深 -11.3%，持续 112 天）',
    }))).toBe('QQQ 回到前高 · 最深 -11.3%');

    expect(alertHeadline(entry({
      symbol: 'NKE', icon: '🔔',
      text: '[盘前] 🟢 NKE · 可买 · $37.45 · 自身深度位达标；斜率 +5.20%（强势上涨，仅风险提示）',
    }))).toBe('🟢 NKE · 可买 · $37.45 · 自身深…');
  });

  it('原文里没有标的代码时，前面补上标的', () => {
    expect(alertHeadline(entry({
      symbol: 'AVL', icon: '🟢',
      text: '[盘中] Z-Score -1.42 阈值提醒 · 1 个标的 · 首次进入负值提醒区',
    }))).toBe('AVL · Z-Score -1.42 阈值提醒…');
  });

  it('截断之后不会留下孤零零的右括号', () => {
    const headline = alertHeadline(entry({
      text: '某条很长很长的提醒 · 说明（这里是括号里的内容，还有更多）',
    }));
    expect(headline.includes('）') && !headline.includes('（')).toBe(false);
  });
});

describe('日期', () => {
  it('北京时间的日期加星期', () => {
    expect(dayLabel('2026-10-20T13:38:55.000Z')).toBe('10-20 周二');
    expect(dayLabel('2026-10-19T04:00:00.000Z')).toBe('10-19 周一');
    expect(dayLabel('不是时间')).toBe('');
  });
});

describe('置顶区只放最近 24 小时', () => {
  const now = new Date('2026-10-20T13:40:00.000Z');
  const rows = [
    entry({ id: 'fresh', occurred_at: '2026-10-20T13:00:00.000Z', indicators: { level: 1 } }),
    entry({ id: 'old', occurred_at: '2026-10-18T13:00:00.000Z', indicators: { level: 1 } }),
  ];

  it('超过 24 小时的重要提醒回到时间线，不再置顶', () => {
    const view = partitionAlerts(rows, { readIds: [], lastOpenedAt: null, now });

    expect(view.pinned.map((item) => item.id)).toEqual(['fresh']);
    expect(view.timeline.map((item) => item.id)).toEqual(['old']);
  });

  it('不传 now 时按当前时间算：很久以前的重要提醒不置顶', () => {
    const ancient = [entry({ id: 'ancient', occurred_at: '2026-01-01T00:00:00.000Z', indicators: { level: 1 } })];
    expect(partitionAlerts(ancient, { readIds: [], lastOpenedAt: null }).pinned).toEqual([]);
  });
});


describe('同一时间、同一类合并成一行', () => {
  const valuation = (symbol: string, minute = '13:20') => entry({
    id: `v-${symbol}`, category: 'valuation', symbol, icon: '🔔', session: 'pre',
    occurred_at: `2026-10-20T${minute}:17.000Z`,
    text: `[盘前] 🟢 ${symbol} · 低估值 · $333.88`,
    indicators: { level: 2 },
  });
  const trade = (symbol: string) => entry({
    id: `t-${symbol}`, category: 'position', symbol, icon: '🧾', session: 'regular',
    occurred_at: '2026-10-19T00:06:00.000Z',
    text: `IBKR · 买入 ${symbol} 10 @ $100.00 · 已同步到决策日志，待补充理由`,
    indicators: { level: 2 },
  });

  it('同一分钟的估值提醒并成「盘前估值 · N 个标的」', () => {
    const items = groupTimeline(['AVGO', 'MCD', 'META', 'NVDA', 'PDD'].map((s) => valuation(s)));

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('group');
    expect(items[0].label).toBe('盘前估值 · 5 个标的');
    expect(items[0].entries).toHaveLength(5);
  });

  it('同一分钟的成交并成「IBKR 成交 · N 笔」', () => {
    const items = groupTimeline(['NVDA', 'AVGO', 'MU', 'TSLA', 'META', 'GOOG'].map(trade));

    expect(items[0].label).toBe('IBKR 成交 · 6 笔');
    expect(items[0].entries).toHaveLength(6);
  });

  it('只有一条就不合并；不同分钟、不同类别各自成组', () => {
    const items = groupTimeline([valuation('AVGO'), valuation('MCD', '14:20'), trade('NVDA')]);

    expect(items.map((item) => item.kind)).toEqual(['single', 'single', 'single']);
  });

  it('重要提醒不被合并进去', () => {
    const items = groupTimeline([
      valuation('AVGO'), valuation('MCD'),
      entry({ id: 'imp', category: 'valuation', symbol: 'NVDA', occurred_at: '2026-10-20T13:20:17.000Z', indicators: { level: 1 } }),
    ]);

    expect(items.filter((item) => item.kind === 'group')).toHaveLength(1);
    expect(items.find((item) => item.kind === 'group')!.entries).toHaveLength(2);
    expect(items.some((item) => item.kind === 'single' && item.entries[0].id === 'imp')).toBe(true);
  });

  it('合并行的时间取组里最新的一条', () => {
    const items = groupTimeline([valuation('AVGO'), valuation('MCD')]);
    expect(items[0].occurredAt).toBe('2026-10-20T13:20:17.000Z');
  });
});
