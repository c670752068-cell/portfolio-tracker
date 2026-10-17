import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  QQQ_DRAWDOWN_TIERS, alertCategoryForEvent, appendAlerts, applyStateAlerts, createAlertLogRoute,
  emptyAlertLog, lastKnownCnnScore, qqqDrawdownEvents, readAlertLog, symbolFromEventKey, voidAlerts,
  writeAlertLog,
} from './alert-log.mjs';
import { formatBuyNotification, formatValuationNotification } from './notification-copy.mjs';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function root() {
  const value = await mkdtemp(join(tmpdir(), 'alert-log-'));
  roots.push(value);
  return value;
}

function closes(start: string, values: number[]) {
  const first = new Date(`${start}T12:00:00Z`);
  return values.map((close, index) => {
    const day = new Date(first);
    day.setUTCDate(day.getUTCDate() + index);
    return { date: day.toISOString().slice(0, 10), close };
  });
}

describe('提醒日志存储', () => {
  it('同一个 dedupe_key 只记一次', () => {
    const first = appendAlerts(emptyAlertLog(), [
      { dedupe_key: 'drawdown:QQQ:-5:2026-10-01', category: 'drawdown', icon: '📉', text: 'QQQ 回撤 -5.02%', occurred_at: '2026-10-16T08:05:12.000Z' },
    ], new Date('2026-10-16T08:05:12.000Z'));
    expect(first.alerts).toHaveLength(1);
    expect(first.alerts[0]).toMatchObject({ category: 'drawdown', pushed: false, backfilled: false });

    const again = appendAlerts(first, [
      { dedupe_key: 'drawdown:QQQ:-5:2026-10-01', category: 'drawdown', icon: '📉', text: 'QQQ 回撤 -5.40%', occurred_at: '2026-10-16T09:00:00.000Z' },
    ], new Date('2026-10-16T09:00:00.000Z'));
    expect(again.alerts).toHaveLength(1);
    expect(again).toBe(first);
  });

  it('缺少必填字段的条目直接丢掉，不写半条记录', () => {
    const store = appendAlerts(emptyAlertLog(), [
      { dedupe_key: '', category: 'drawdown', icon: '📉', text: '没有 key' },
      { dedupe_key: 'x', category: 'drawdown', icon: '📉', text: '' },
      { dedupe_key: 'ok', category: 'drawdown', icon: '📉', text: '正常的一条', occurred_at: '2026-10-16T08:00:00.000Z' },
    ], new Date('2026-10-16T08:00:00.000Z'));

    expect(store.alerts.map((item) => item.text)).toEqual(['正常的一条']);
  });

  it('存盘读盘不丢字段，坏文件退回空日志', async () => {
    const dir = await root();
    const store = appendAlerts(emptyAlertLog(), [{
      dedupe_key: 'push:sell:AVGO:2026-10-21', category: 'sell_line', symbol: 'AVGO', icon: '💰',
      text: 'AVGO 收盘 $447.10 ≥ 卖出线 $446.56 · 正股分批', value: 447.1, threshold: 446.56,
      pushed: true, session: 'closed', indicators: { cnn: 32 }, occurred_at: '2026-10-21T08:05:20.000Z',
    }], new Date('2026-10-21T08:05:20.000Z'));
    await writeAlertLog(dir, store);

    expect(await readAlertLog(dir)).toEqual(store);
    expect(await readAlertLog(await root())).toEqual(emptyAlertLog());
  });

  it('读接口只读不写', async () => {
    const dir = await root();
    const sent: { status: number; body: unknown }[] = [];
    const route = createAlertLogRoute({ root: dir, sendJson: (_res: unknown, status: number, body: unknown) => sent.push({ status, body }) });

    expect(await route(new URL('http://127.0.0.1/api/portfolio/alert-log'), { method: 'GET', headers: {} }, {})).toBe(true);
    expect(sent[0]).toEqual({ status: 200, body: { log: emptyAlertLog() } });

    await route(new URL('http://127.0.0.1/api/portfolio/alert-log'), { method: 'POST', headers: {} }, {});
    expect(sent[1].status).toBe(405);
  });
});

describe('QQQ 回撤档位', () => {
  it('档位是 -5 到 -30', () => {
    expect(QQQ_DRAWDOWN_TIERS).toEqual([5, 10, 15, 20, 25, 30]);
  });

  it('按收盘价首次跌破每一档各记一行，同一轮不重复', () => {
    // 前高 100 → 一路跌到 88：先破 -5%，再破 -10%
    const events = qqqDrawdownEvents(closes('2026-10-01', [100, 97, 94, 92, 88, 89]));

    expect(events.map((event) => [event.tier, event.date])).toEqual([
      [5, '2026-10-03'],
      [10, '2026-10-05'],
    ]);
    expect(events[0].text).toContain('QQQ 回撤');
    expect(events[0].text).toContain('本轮首次跌破 -5%');
    expect(events[0].dedupe_key).toBe('qqq-drawdown:5:2026-10-01');
    expect(events[0].category).toBe('drawdown');
  });

  it('创新高后写一行「本轮回撤结束」，并给出最深回撤和持续天数，档位重置', () => {
    const events = qqqDrawdownEvents(closes('2026-10-01', [100, 94, 88, 95, 101, 95, 90]));
    const ended = events.find((event) => event.kind === 'recovered');

    expect(ended).toBeTruthy();
    expect(ended!.text).toContain('本轮回撤结束');
    expect(ended!.text).toContain('-12');
    expect(ended!.dedupe_key).toBe('qqq-drawdown-end:2026-10-01');
    // 新一轮又跌破 -5% 和 -10%，用新的前高日期做 key
    const second = events.filter((event) => event.kind === 'tier' && event.dedupe_key.endsWith('2026-10-05'));
    expect(second.map((event) => event.tier)).toEqual([5, 10]);
  });

  it('只回看指定起点之后的数据', () => {
    const all = closes('2026-01-01', [100, 90, 100, 100, 95, 90]);
    const events = qqqDrawdownEvents(all, { from: '2026-01-03' });

    expect(events.every((event) => event.date >= '2026-01-03')).toBe(true);
  });

  it('数据不足或没有回撤时不产生条目', () => {
    expect(qqqDrawdownEvents([])).toEqual([]);
    expect(qqqDrawdownEvents(closes('2026-10-01', [100, 101, 102]))).toEqual([]);
  });
});

describe('阈值线与卖出军令的状态变化', () => {
  it('从未触发变触发记一行，恢复正常再记一行，中间不刷屏', () => {
    const first = applyStateAlerts(emptyAlertLog(), [{
      key: 'cnn', state: 'triggered', category: 'sentiment', icon: '😨',
      text: 'CNN 恐惧贪婪 27 < 30 · 到达开仓线', value: 27, threshold: 30,
    }], new Date('2026-10-17T08:06:30.000Z'));
    expect(first.alerts).toHaveLength(1);
    expect(first.states.cnn).toBe('triggered');

    const again = applyStateAlerts(first, [{
      key: 'cnn', state: 'triggered', category: 'sentiment', icon: '😨',
      text: 'CNN 恐惧贪婪 26 < 30 · 到达开仓线', value: 26, threshold: 30,
    }], new Date('2026-10-18T08:06:30.000Z'));
    expect(again.alerts).toHaveLength(1);
    expect(again).toBe(first);

    const back = applyStateAlerts(again, [{
      key: 'cnn', state: 'normal', category: 'sentiment', icon: '🙂',
      text: 'CNN 恐惧贪婪 34 回到 30 以上 · 离开开仓线', value: 34, threshold: 30,
    }], new Date('2026-10-20T08:06:30.000Z'));
    expect(back.alerts).toHaveLength(2);
    expect(back.states.cnn).toBe('normal');
  });

  it('第一次见到「正常」不记一行，免得上线当天刷一堆「恢复正常」', () => {
    const store = applyStateAlerts(emptyAlertLog(), [{
      key: 'vix', state: 'normal', category: 'sentiment', icon: '🙂', text: 'VIX 16.5 正常',
    }], new Date('2026-10-16T08:00:00.000Z'));

    expect(store.alerts).toEqual([]);
    expect(store.states.vix).toBe('normal');
  });

  it('卖出军令变可执行记一行，退回等待也记一行', () => {
    const ready = applyStateAlerts(emptyAlertLog(), [{
      key: 'sell:AVGO', state: 'triggered', category: 'sell_line', symbol: 'AVGO', icon: '💰',
      text: 'AVGO 卖出军令变为可执行 · 正股分批 $446.56', threshold: 446.56,
    }], new Date('2026-10-21T08:05:20.000Z'));

    expect(ready.alerts[0]).toMatchObject({ category: 'sell_line', symbol: 'AVGO' });
    expect(ready.states['sell:AVGO']).toBe('triggered');
  });
});

describe('作废标记（只标不删）', () => {
  it('按 dedupe_key 标记已作废，条目本身一条都不少', () => {
    const store = appendAlerts(emptyAlertLog(), [
      { dedupe_key: 'sell-line-live:TSLA:31.41:2026-10-16', category: 'sell_line', symbol: 'TSLA', text: 'TSLA $353.18 ≥ 卖出线 $31.41' },
      { dedupe_key: 'keep-me', category: 'other', symbol: 'QQQ', text: '正常的一条' },
    ], new Date('2026-10-16T17:54:38.479Z'));

    const next = voidAlerts(store, {
      dedupeKeys: ['sell-line-live:TSLA:31.41:2026-10-16'],
      reason: '卖出线未过合理性校验',
    }, new Date('2026-10-17T03:00:00.000Z'));

    expect(next.alerts).toHaveLength(2);
    const voided = next.alerts.find((item) => item.dedupe_key.startsWith('sell-line-live'));
    expect(voided).toMatchObject({
      voided: true,
      voided_reason: '卖出线未过合理性校验',
      voided_at: '2026-10-17T03:00:00.000Z',
    });
    expect(next.alerts.find((item) => item.dedupe_key === 'keep-me')?.voided).toBeUndefined();
  });

  it('没有命中任何 key 时原样返回', () => {
    const store = appendAlerts(emptyAlertLog(), [{ dedupe_key: 'a', category: 'other', text: '一条' }]);
    expect(voidAlerts(store, { dedupeKeys: ['不存在'], reason: 'x' })).toBe(store);
  });

  it('追加时保留作废和推送状态字段', () => {
    const store = appendAlerts(emptyAlertLog(), [{
      dedupe_key: 'x', category: 'other', text: '一条', push_state: 'quiet_hours', push_repeat: 3,
    }]);
    expect(store.alerts[0]).toMatchObject({ push_state: 'quiet_hours', push_repeat: 3 });
  });
});

describe('最近一次已知的 CNN 读数', () => {
  it('取日志里最后一条带数值的 CNN 记录', () => {
    const store = appendAlerts(emptyAlertLog(), [
      { dedupe_key: 'cnn-a', category: 'sentiment', symbol: 'CNN', text: 'CNN 28', value: 28, occurred_at: '2026-10-16T15:43:43.307Z' },
      { dedupe_key: 'cnn-b', category: 'sentiment', symbol: 'CNN', text: 'CNN 19', value: 19, occurred_at: '2026-10-16T18:01:31.097Z' },
      { dedupe_key: 'vix-a', category: 'sentiment', symbol: 'VIX', text: 'VIX 20', value: 20, occurred_at: '2026-10-16T18:09:31.746Z' },
    ]);
    expect(lastKnownCnnScore(store)).toBe(19);
  });

  it('没有 CNN 记录时返回 null，不返回 0', () => {
    expect(lastKnownCnnScore(emptyAlertLog())).toBeNull();
  });
});

describe('收盘确认的回撤文案', () => {
  const series = [
    { date: '2026-10-14', close: 759.66 },
    { date: '2026-10-15', close: 728.0 },
    { date: '2026-10-16', close: 709.8 },
  ];

  it('盘中已经报过同一档时，收盘那条写成「仍在 -5% 档」', () => {
    const events = qqqDrawdownEvents(series, { liveFiredTiers: new Set(['5:2026-10-14']) });
    const tier5 = events.filter((event) => event.tier === 5);
    expect(tier5).toHaveLength(1);
    expect(tier5[0].text).toBe('[收盘确认] QQQ 收盘 709.80 · 离前高 -6.56% · 仍在 -5% 档');
    expect(tier5[0].dedupe_key).toBe('qqq-drawdown-confirm:5:2026-10-14');
  });

  it('盘中没报过就沿用原来的「本轮首次跌破」，回填记录不受影响', () => {
    const events = qqqDrawdownEvents(series);
    const tier5 = events.filter((event) => event.tier === 5);
    expect(tier5[0].text).toContain('本轮首次跌破 -5%');
    expect(tier5[0].dedupe_key).toBe('qqq-drawdown:5:2026-10-14');
  });
});

describe('推送事件写进日志时的标的和分类', () => {
  it('「可买」归到回撤，并从 key 里取出标的（真实事件格式）', () => {
    const event = formatBuyNotification('NKE', '自身深度位已达标；斜率 -68.37%（强势下跌，仅风险提示）', 37.45);

    expect(event).not.toBeNull();
    expect(symbolFromEventKey(event)).toBe('NKE');
    expect(alertCategoryForEvent(event)).toBe('drawdown');
  });

  it('「低估值」归到估值（真实事件格式）', () => {
    const event = formatValuationNotification('AVGO', {
      current: 23.26, zone: 'low', icon: '🟢', message: '按计划分批买入或继续持有', available: true, stale: false,
    }, 341.61);

    expect(event).not.toBeNull();
    expect(symbolFromEventKey(event)).toBe('AVGO');
    expect(alertCategoryForEvent(event)).toBe('valuation');
  });

  it('key 第二段不是标的代码时返回 null，不硬塞一个', () => {
    expect(symbolFromEventKey({ key: 'growth-watchlist-unresolved:NVDA,MSFT' })).toBeNull();
    expect(symbolFromEventKey({ key: 'system-heartbeat' })).toBeNull();
  });

  it('事件自带 symbol 时优先用它', () => {
    expect(symbolFromEventKey({ key: 'buy:NKE:x', symbol: 'tsla' })).toBe('TSLA');
  });
});
