import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  QQQ_DRAWDOWN_TIERS, appendAlerts, applyStateAlerts, createAlertLogRoute, emptyAlertLog,
  qqqDrawdownEvents, readAlertLog, writeAlertLog,
} from './alert-log.mjs';

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
