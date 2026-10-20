import { describe, expect, it } from 'vitest';
import type { AlertLogEntry } from './alertLog';
import {
  HEADLINE_MAX, alertAccent, alertHeadline, isLogOnly, partitionAlerts, pushStateIcon, suggestedSide,
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
    }))).toBe('UDOW $67.41 Z 0.52 偏强');
  });

  it('跌得更深那一条同样压成一行', () => {
    expect(alertHeadline(entry({
      icon: '🟢', symbol: 'GDX', text: '[盘中] GDX $85.66 · Z -0.45 → -0.53 · 跌得更深，偏弱',
    }))).toBe('GDX $85.66 Z -0.53 偏弱');
  });

  it('估值推送那一条砍掉分号后面的操作说明', () => {
    expect(alertHeadline(entry({
      category: 'valuation', symbol: 'AVGO', icon: '🔔',
      text: '[盘前] 🟢 AVGO · 低估值 · $333.88 · 远期 PE 22.60；按计划分批买入或继续持有。',
    }))).toBe('🟢 AVGO 低估值 $333.88 远期 PE…');
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
    }))).toBe('QQQ 回撤 -5.02%（前高 759.66…');
  });

  it('汇总行显示「N 个标的」，不显示明细', () => {
    expect(alertHeadline(entry({
      category: 'valuation', symbol: null, icon: '📋', text: '[盘前] 估值汇总 · 5 个标的',
    }))).toBe('估值汇总 5 个标的');
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

  it('未读的重要提醒置顶，读过的回到时间顺序', () => {
    const fresh = partitionAlerts(rows, { readIds: [], lastOpenedAt: '2026-10-20T00:00:00.000Z' });
    expect(fresh.pinned.map((item) => item.id)).toEqual(['new-important', 'old-important']);
    expect(fresh.timeline.map((item) => item.id)).toEqual(['new-normal', 'old-normal']);

    const read = partitionAlerts(rows, { readIds: ['new-important'], lastOpenedAt: '2026-10-20T00:00:00.000Z' });
    expect(read.pinned.map((item) => item.id)).toEqual(['old-important']);
    expect(read.timeline.map((item) => item.id)).toEqual(['new-important', 'new-normal', 'old-normal']);
  });

  it('未读数量按上次打开时间算', () => {
    expect(partitionAlerts(rows, { readIds: [], lastOpenedAt: '2026-10-20T00:00:00.000Z' }).unread).toBe(2);
    expect(partitionAlerts(rows, { readIds: [], lastOpenedAt: null }).unread).toBe(4);
    expect(partitionAlerts(rows, { readIds: [], lastOpenedAt: '2026-10-21T00:00:00.000Z' }).unread).toBe(0);
  });

  it('分隔线放在上次打开之后新增的最后一条下面', () => {
    const view = partitionAlerts(rows, { readIds: ['new-important'], lastOpenedAt: '2026-10-20T00:00:00.000Z' });
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

