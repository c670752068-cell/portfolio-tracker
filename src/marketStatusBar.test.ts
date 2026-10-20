import { describe, expect, it } from 'vitest';
import type { AlertLogEntry } from './alertLog';
import {
  SESSION_LABELS, cnnFromAlerts, cnnScoreFrom, importantTodayCount, parseStatusQuotes, qqqDrawdownPct,
  statusCards, vixChangePct,
} from './marketStatusBar';

function alert(partial: Partial<AlertLogEntry>): AlertLogEntry {
  return {
    id: 'a', occurred_at: '2026-10-20T13:38:00.000Z', category: 'sentiment', symbol: 'CNN',
    icon: '😱', text: 'CNN', value: null, threshold: null, pushed: false, backfilled: false,
    session: null, indicators: null, ...partial,
  } as AlertLogEntry;
}

describe('顶部状态条的数字', () => {
  it('QQQ 离前高按完整收盘序列里的最高点算', () => {
    const series = [{ date: '2026-10-01', close: 700 }, { date: '2026-10-15', close: 759.66 }, { date: '2026-10-17', close: 740 }];
    expect(qqqDrawdownPct(712.3, series)).toBeCloseTo(-6.23, 2);
    expect(qqqDrawdownPct(770, series)).toBeCloseTo(1.36, 2);
    expect(qqqDrawdownPct(null, series)).toBeNull();
    expect(qqqDrawdownPct(712.3, [])).toBeNull();
  });

  it('VIX 较昨收的涨跌幅，没有昨收就算不出', () => {
    expect(vixChangePct({ price: 21.96, previousClose: 16.46 })).toBeCloseTo(33.41, 2);
    expect(vixChangePct({ price: 21.96, previousClose: null })).toBeNull();
    expect(vixChangePct({ price: null, previousClose: 16.46 })).toBeNull();
    expect(vixChangePct({ price: 21.96, previousClose: 0 })).toBeNull();
  });

  it('CNN 的「上次」取日志里最近一次不同的读数', () => {
    const alerts = [
      alert({ id: 'c1', occurred_at: '2026-10-18T13:00:00.000Z', value: 28 }),
      alert({ id: 'c2', occurred_at: '2026-10-19T13:00:00.000Z', value: 18 }),
      alert({ id: 'c3', occurred_at: '2026-10-20T13:00:00.000Z', value: 18 }),
      alert({ id: 'x1', occurred_at: '2026-10-20T13:30:00.000Z', symbol: 'VIX', value: 21.9 }),
    ];

    expect(cnnFromAlerts(alerts, 18, '2026-10-20T13:00:00.000Z')).toEqual({
      score: 18, previous: 28, at: '2026-10-20T13:00:00.000Z',
    });
  });

  it('日志里没有 CNN 记录时没有「上次」，也不编一个', () => {
    expect(cnnFromAlerts([], 18, null)).toEqual({ score: 18, previous: null, at: null });
    expect(cnnFromAlerts([], null, null)).toEqual({ score: null, previous: null, at: null });
  });

  it('今日重要提醒按北京时间当天算，作废的不计', () => {
    const now = new Date('2026-10-20T13:40:00.000Z'); // 北京 10-20 21:40
    const alerts = [
      alert({ id: 'i1', occurred_at: '2026-10-20T13:38:00.000Z', indicators: { level: 1 } }),
      alert({ id: 'i2', occurred_at: '2026-10-20T01:00:00.000Z', indicators: { level: 1 } }), // 北京 10-20 09:00
      alert({ id: 'i3', occurred_at: '2026-10-19T13:38:00.000Z', indicators: { level: 1 } }),
      alert({ id: 'i4', occurred_at: '2026-10-20T13:39:00.000Z', indicators: { level: 1 }, voided: true }),
      alert({ id: 'n1', occurred_at: '2026-10-20T13:39:00.000Z', indicators: { level: 2 } }),
    ];

    expect(importantTodayCount(alerts, now)).toBe(2);
  });
});

describe('五张小卡片', () => {
  const base = {
    qqq: { price: 712.3, previousClose: 721.53 },
    qqqSeries: [{ date: '2026-10-15', close: 759.66 }],
    vix: { price: 21.96, previousClose: 16.46 },
    cnn: { score: 18, previous: 28, at: '2026-10-20T13:00:00.000Z' },
    importantToday: 2,
    session: 'regular',
  };

  it('QQQ、VIX、CNN、今日重要、当前时段各一张', () => {
    const cards = statusCards(base);

    expect(cards.map((card) => card.key)).toEqual(['qqq', 'vix', 'cnn', 'important', 'session']);
    expect(cards[0]).toMatchObject({ label: 'QQQ', value: '712.30', detail: '离前高 -6.2%' });
    expect(cards[1]).toMatchObject({ label: 'VIX', value: '21.96', detail: '较昨收 +33.4% ↑', tone: 'warn' });
    expect(cards[2]).toMatchObject({ label: 'CNN', value: '18', detail: '较上次 -10 ↓', tone: 'warn' });
    expect(cards[3]).toMatchObject({ label: '今日重要', value: '2', detail: '条' });
    expect(cards[4]).toMatchObject({ label: '当前时段', value: '盘中' });
  });

  it('VIX 回落用绿色向下箭头，CNN 回升也是', () => {
    const cards = statusCards({
      ...base,
      vix: { price: 15.2, previousClose: 16.46 },
      cnn: { score: 32, previous: 28, at: '2026-10-20T13:00:00.000Z' },
    });

    expect(cards[1]).toMatchObject({ detail: '较昨收 -7.7% ↓', tone: 'calm' });
    expect(cards[2]).toMatchObject({ detail: '较上次 +4 ↑', tone: 'calm' });
  });

  it('数字缺失时写「暂无」，不拿 0 顶替', () => {
    const cards = statusCards({
      qqq: null, qqqSeries: [], vix: null,
      cnn: { score: null, previous: null, at: null }, importantToday: 0, session: null,
    });

    expect(cards[0]).toMatchObject({ value: '暂无', detail: '离前高 暂无' });
    expect(cards[1]).toMatchObject({ value: '暂无', detail: '较昨收 暂无' });
    expect(cards[2]).toMatchObject({ value: '暂无', detail: '较上次 暂无' });
    expect(cards[3]).toMatchObject({ value: '0' });
    expect(cards[4]).toMatchObject({ value: '暂无' });
  });

  it('五个时段的中文名', () => {
    expect(SESSION_LABELS).toEqual({
      pre: '盘前', regular: '盘中', post: '盘后', overnight: '夜盘', closed: '休市',
    });
  });
});

describe('状态条的数据来源', () => {
  it('行情代理返回里挑出 QQQ 和 VIX，顺带拿到时段和数据时间', () => {
    expect(parseStatusQuotes({
      quotes: [
        { symbol: 'QQQ', price: 712.3, previousClose: 721.53 },
        { symbol: '^VIX', price: 21.96, previousClose: 16.46 },
      ],
      session: 'regular',
      time: '2026-10-20T13:40:12.000Z',
    })).toEqual({
      qqq: { price: 712.3, previousClose: 721.53 },
      vix: { price: 21.96, previousClose: 16.46 },
      session: 'regular',
      time: '2026-10-20T13:40:12.000Z',
    });
  });

  it('返回缺字段或格式不对时一律给空值', () => {
    expect(parseStatusQuotes(null)).toEqual({ qqq: null, vix: null, session: null, time: null });
    expect(parseStatusQuotes({ quotes: [{ symbol: 'QQQ' }], session: '乱写', time: '不是时间' }))
      .toEqual({ qqq: { price: null, previousClose: null }, vix: null, session: null, time: null });
  });

  it('从量化快照读 CNN，取不到就是空', () => {
    expect(cnnScoreFrom({ context: { cnn_fear_greed: { available: true, score: 18.3, as_of: '2026-10-20' } } }))
      .toEqual({ score: 18.3, at: '2026-10-20' });
    expect(cnnScoreFrom({ context: { cnn_fear_greed: { available: false, score: 18.3 } } }))
      .toEqual({ score: null, at: null });
    expect(cnnScoreFrom(null)).toEqual({ score: null, at: null });
    expect(cnnScoreFrom({ context: {} })).toEqual({ score: null, at: null });
  });
});

