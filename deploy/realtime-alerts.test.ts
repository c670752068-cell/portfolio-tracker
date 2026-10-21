import { describe, expect, it } from 'vitest';
import {
  NEAR_BREAKOUT_LEVEL, NEAR_BREAKOUT_MIN_SESSIONS, NEAR_BREAKOUT_RESET, QQQ_BIG_MOVE_PCT, RESONANCE_HISTORY_NOTE, SESSION_CADENCE_MS, STOCK_BIG_MOVE_PCT, bigMoveAlert, bigMoveLimitFor, cnnAlerts, cnnFloorText, cnnTierStates, intradayZAlerts, nearBreakoutAlerts, nearBreakoutStateKey, nearBreakoutStates, negativeStreak, qqqRealtimeAlerts, resonanceAlert, sessionLabel, vixAlerts,
} from './realtime-alerts.mjs';

describe('实时监控的节奏与时段', () => {
  it('盘中 1 分钟、盘前盘后 2 分钟、夜盘 5 分钟', () => {
    expect(SESSION_CADENCE_MS.regular).toBe(60_000);
    expect(SESSION_CADENCE_MS.pre).toBe(120_000);
    expect(SESSION_CADENCE_MS.post).toBe(120_000);
    expect(SESSION_CADENCE_MS.overnight).toBe(300_000);
  });

  it('时段标签是中文', () => {
    expect(sessionLabel('pre')).toBe('盘前');
    expect(sessionLabel('regular')).toBe('盘中');
    expect(sessionLabel('post')).toBe('盘后');
    expect(sessionLabel('overnight')).toBe('夜盘');
    expect(sessionLabel('closed')).toBe('休市');
  });
});

describe('QQQ 实时回撤档位', () => {
  const previousHigh = 759.66;

  it('夜盘跌破 -5% 立刻写一行，带时段标签和档位', () => {
    const alerts = qqqRealtimeAlerts({
      price: 712.3, previousHigh, session: 'overnight', firedKeys: new Set(), peakDate: '2026-10-15',
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ level: 'important', category: 'drawdown', symbol: 'QQQ', icon: '📉' });
    expect(alerts[0].text).toContain('[夜盘]');
    expect(alerts[0].text).toContain('712.30');
    expect(alerts[0].text).toContain('-6.2');
    expect(alerts[0].text).toContain('本轮首次跌破 -5%');
    expect(alerts[0].dedupe_key).toBe('qqq-drawdown-live:5:2026-10-15');
  });

  it('同一档位记过就不再记，更深的档位照样记', () => {
    const fired = new Set(['qqq-drawdown-live:5:2026-10-15']);
    const same = qqqRealtimeAlerts({ price: 712.3, previousHigh, session: 'pre', firedKeys: fired, peakDate: '2026-10-15' });
    expect(same).toEqual([]);

    const deeper = qqqRealtimeAlerts({ price: 670, previousHigh, session: 'regular', firedKeys: fired, peakDate: '2026-10-15' });
    expect(deeper.map((item) => item.tier)).toEqual([10]);
  });

  it('收盘确认单独写一行，key 和实时那条不冲突', () => {
    const confirm = qqqRealtimeAlerts({
      price: 700, previousHigh, session: 'closed', firedKeys: new Set(), peakDate: '2026-10-15', confirmation: true,
    });

    expect(confirm[0].text).toContain('[收盘确认]');
    expect(confirm[0].dedupe_key).toBe('qqq-drawdown-confirm:5:2026-10-15');
  });

  it('防抖：离档位不到 0.15 个百分点时不触发', () => {
    const edge = previousHigh * 0.9501;
    expect(qqqRealtimeAlerts({ price: edge, previousHigh, session: 'regular', firedKeys: new Set(), peakDate: '2026-10-15' })).toEqual([]);
  });

  it('没跌破任何档位就不写', () => {
    expect(qqqRealtimeAlerts({ price: 750, previousHigh, session: 'regular', firedKeys: new Set(), peakDate: '2026-10-15' })).toEqual([]);
  });
});

describe('VIX 提醒', () => {
  it('较昨收涨 +15 / +25 / +35 各一档，+25 以上算重要', () => {
    const alerts = vixAlerts({ price: 21.96, previousClose: 16.46, session: 'regular', firedKeys: new Set(), day: '2026-10-16' });

    const rises = alerts.filter((item) => item.kind === 'rise');
    expect(rises.map((item) => item.tier)).toEqual([15, 25]);
    expect(rises.at(-1)).toMatchObject({ level: 'important', category: 'sentiment', icon: '⚡' });
    expect(rises.at(-1)!.text).toContain('较昨收 +33.4%');
    expect(rises.at(-1)!.text).toContain('[盘中]');
    // 21.96 同时升破了绝对档位 20，所以还会多一条
    expect(alerts.filter((item) => item.kind === 'level').map((item) => item.tier)).toEqual([20]);
  });

  it('升破 20 / 23 / 30 各一档，23 以上算重要', () => {
    const alerts = vixAlerts({ price: 24.1, previousClose: 23.9, session: 'regular', firedKeys: new Set(), day: '2026-10-16' });
    const levels = alerts.filter((item) => item.kind === 'level');

    expect(levels.map((item) => item.tier)).toEqual([20, 23]);
    expect(levels.at(-1)).toMatchObject({ level: 'important' });
  });

  it('从当日高点回落 15% 或跌回 20 以下算普通', () => {
    const alerts = vixAlerts({
      price: 19.1, previousClose: 18, dayHigh: 22.5, session: 'regular', firedKeys: new Set(), day: '2026-10-16',
    });

    expect(alerts.some((item) => item.kind === 'relief' && item.level === 'normal')).toBe(true);
    expect(alerts.find((item) => item.kind === 'relief')!.text).toContain('回落');
  });
});

describe('CNN 恐惧贪婪', () => {
  it('跌破 30 / 25 / 20 / 15 各一次，跌破 20 算重要', () => {
    const alerts = cnnAlerts({ score: 18, previousScore: 28, firedKeys: new Set(), day: '2026-10-16' });

    expect(alerts.some((item) => item.level === 'important')).toBe(true);
    expect(alerts[0].text).toContain('18');
    expect(alerts[0].icon).toBe('😱');
  });

  it('比上次又降 5 点以上记一条「恐慌加剧」', () => {
    const alerts = cnnAlerts({ score: 22, previousScore: 28, firedKeys: new Set(['cnn-tier:25:2026-10-16']), day: '2026-10-16' });

    expect(alerts.some((item) => item.kind === 'deeper' && item.text.includes('恐慌加剧'))).toBe(true);
  });

  it('回升 5 点或回到 30 以上算缓解，普通级', () => {
    const alerts = cnnAlerts({ score: 33, previousScore: 26, firedKeys: new Set(), day: '2026-10-16' });

    expect(alerts.some((item) => item.kind === 'relief' && item.level === 'normal')).toBe(true);
    expect(alerts.find((item) => item.kind === 'relief')!.icon).toBe('🙂');
  });
});

describe('盘中 Z-Score 穿档', () => {
  it('TSLA 从 -0.75 跌到 -1.01，提示跌得更深', () => {
    const alerts = intradayZAlerts({
      symbol: 'TSLA', price: 353.14, previousZ: -0.75, currentZ: -1.01,
      session: 'regular', firedKeys: new Set(), day: '2026-10-16',
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ level: 'normal', category: 'zscore', icon: '🟢' });
    expect(alerts[0].text).toContain('Z -0.75 → -1.01');
    expect(alerts[0].text).toContain('跌得更深');
    expect(alerts[0].dedupe_key).toBe('z-cross:TSLA:-1:down:2026-10-16');
  });

  it('穿过 ±1.5 算重要，向上穿提示涨得更多', () => {
    const alerts = intradayZAlerts({
      symbol: 'NVDA', price: 217.12, previousZ: 1.38, currentZ: 1.52,
      session: 'regular', firedKeys: new Set(), day: '2026-10-16',
    });

    expect(alerts[0]).toMatchObject({ level: 'important', icon: '🔴' });
    expect(alerts[0].text).toContain('进入卖出区');
  });

  it('Z 措辞按 1.2 / 1.5 分档，0.52 不说「接近卖出区」', () => {
    const [weak] = intradayZAlerts({
      symbol: 'UDOW', price: 67.41, previousZ: 0.38, currentZ: 0.52,
      session: 'regular', firedKeys: new Set(), day: '2026-10-20',
    });
    expect(weak.text).toContain('涨得更多，偏强');
    expect(weak.text).not.toContain('接近卖出区');

    const [soft] = intradayZAlerts({
      symbol: 'GDX', price: 85.66, previousZ: -0.45, currentZ: -0.53,
      session: 'regular', firedKeys: new Set(), day: '2026-10-20',
    });
    expect(soft.text).toContain('跌得更深，偏弱');
    expect(soft.text).not.toContain('接近买入区');

    const [near] = intradayZAlerts({
      symbol: 'NVDA', price: 217.12, previousZ: 0.95, currentZ: 1.28,
      session: 'regular', firedKeys: new Set(), day: '2026-10-20',
    });
    expect(near.text).toContain('接近卖出区 +1.5');

    const [nearBuy] = intradayZAlerts({
      symbol: 'TSLA', price: 353.14, previousZ: -0.95, currentZ: -1.22,
      session: 'regular', firedKeys: new Set(), day: '2026-10-20',
    });
    expect(nearBuy.text).toContain('接近买入区 -1.5');

    const [inZone] = intradayZAlerts({
      symbol: 'MU', price: 911, previousZ: -1.41, currentZ: -1.63,
      session: 'regular', firedKeys: new Set(), day: '2026-10-20',
    });
    expect(inZone.text).toContain('已进入买入区');
  });

  it('同一档同一方向一天只记一次，没穿档不记', () => {
    const fired = new Set(['z-cross:TSLA:-1:down:2026-10-16']);
    expect(intradayZAlerts({ symbol: 'TSLA', price: 1, previousZ: -0.75, currentZ: -1.01, session: 'regular', firedKeys: fired, day: '2026-10-16' })).toEqual([]);
    expect(intradayZAlerts({ symbol: 'TSLA', price: 1, previousZ: -0.75, currentZ: -0.8, session: 'regular', firedKeys: new Set(), day: '2026-10-16' })).toEqual([]);
  });
});

describe('个股大幅波动与多指标共振', () => {
  it('杠杆 ETF 按倍数放大阈值：2 倍 ±8%、3 倍 ±12%', () => {
    expect(bigMoveLimitFor('TSLL')).toBe(8);
    expect(bigMoveLimitFor('AVL')).toBe(8);
    expect(bigMoveLimitFor('SOXL')).toBe(12);
    expect(bigMoveLimitFor('TQQQ')).toBe(12);
    expect(bigMoveLimitFor('NVDA')).toBe(5);
    expect(bigMoveLimitFor('QQQ')).toBe(2);

    // SOXL 涨 5% 不再报，涨 12.5% 才报
    expect(bigMoveAlert({ symbol: 'SOXL', price: 103.59, changePercent: 0.05, held: true, session: 'regular', firedKeys: new Set(), day: '2026-10-20' })).toBeNull();
    const big = bigMoveAlert({ symbol: 'SOXL', price: 110, changePercent: 0.125, held: true, session: 'regular', firedKeys: new Set(), day: '2026-10-20' });
    expect(big).toMatchObject({ threshold: 12 });

    // 2 倍的 TSLL：5% 不报，8.5% 报
    expect(bigMoveAlert({ symbol: 'TSLL', price: 9.5, changePercent: 0.05, held: true, session: 'regular', firedKeys: new Set(), day: '2026-10-20' })).toBeNull();
    expect(bigMoveAlert({ symbol: 'TSLL', price: 9.5, changePercent: 0.085, held: true, session: 'regular', firedKeys: new Set(), day: '2026-10-20' })).toMatchObject({ threshold: 8 });
  });

  it('阈值可以从配置文件覆盖', () => {
    expect(bigMoveLimitFor('SOXL', { leveraged3xPct: 20 })).toBe(20);
    expect(bigMoveLimitFor('NVDA', { defaultPct: 7 })).toBe(7);
    expect(bigMoveLimitFor('ZZZZ', { leveraged2x: ['ZZZZ'] })).toBe(8);
  });

  it('持仓跌超 5% 算普通，非持仓只记录；QQQ 用 2%', () => {
    expect(STOCK_BIG_MOVE_PCT).toBe(5);
    expect(QQQ_BIG_MOVE_PCT).toBe(2);

    const held = bigMoveAlert({ symbol: 'AVGO', price: 341.61, changePercent: -0.054, held: true, session: 'regular', firedKeys: new Set(), day: '2026-10-16' });
    expect(held).toMatchObject({ level: 'normal', icon: '⚠️' });
    expect(held!.text).toContain('持仓标的');

    const watch = bigMoveAlert({ symbol: 'MU', price: 911, changePercent: 0.061, held: false, session: 'regular', firedKeys: new Set(), day: '2026-10-16' });
    expect(watch).toMatchObject({ level: 'log_only' });

    expect(bigMoveAlert({ symbol: 'QQQ', price: 712, changePercent: -0.025, held: false, session: 'regular', firedKeys: new Set(), day: '2026-10-16' })).toBeTruthy();
    expect(bigMoveAlert({ symbol: 'AVGO', price: 341, changePercent: -0.02, held: true, session: 'regular', firedKeys: new Set(), day: '2026-10-16' })).toBeNull();
  });

  it('三个条件同时满足才算共振，并附历史参考', () => {
    const alert = resonanceAlert({
      qqqDrawdownPct: -6.3, vixChangePct: 33, cnnScore: 18, session: 'regular', firedKeys: new Set(), day: '2026-10-16',
    });

    expect(alert).toMatchObject({ level: 'important', icon: '⭐', category: 'other' });
    expect(alert!.text).toContain('多指标共振');
    expect(alert!.detail).toBe(RESONANCE_HISTORY_NOTE);
    expect(alert!.detail).toContain('81%');
    expect(alert!.text).toContain('今天还没收盘');

    expect(resonanceAlert({ qqqDrawdownPct: -4, vixChangePct: 33, cnnScore: 18, session: 'regular', firedKeys: new Set(), day: '2026-10-16' })).toBeNull();
    expect(resonanceAlert({ qqqDrawdownPct: -6.3, vixChangePct: 10, cnnScore: 18, session: 'regular', firedKeys: new Set(), day: '2026-10-16' })).toBeNull();
    expect(resonanceAlert({ qqqDrawdownPct: -6.3, vixChangePct: 33, cnnScore: 30, session: 'regular', firedKeys: new Set(), day: '2026-10-16' })).toBeNull();
  });
});

describe('空值不能当成 0', () => {
  it('没有上一次 CNN 时不写「较上次 0」', () => {
    const alerts = cnnAlerts({ score: 21, previousScore: null, firedKeys: new Set(), day: '2026-10-16' });

    expect(alerts.some((item) => item.kind === 'relief')).toBe(false);
    expect(alerts.some((item) => item.kind === 'deeper')).toBe(false);
    expect(alerts.every((item) => !item.text.includes('较上次 0'))).toBe(true);
  });

  it('没有昨收时不算 VIX 涨幅，只按绝对档位', () => {
    const alerts = vixAlerts({ price: 24, previousClose: null, session: 'regular', firedKeys: new Set(), day: '2026-10-16' });

    expect(alerts.every((item) => item.kind !== 'rise')).toBe(true);
    expect(alerts.some((item) => item.kind === 'level')).toBe(true);
  });

  it('没有现价时不产生任何提醒', () => {
    expect(qqqRealtimeAlerts({ price: null, previousHigh: 759.66, session: 'regular', firedKeys: new Set(), peakDate: '2026-10-15' })).toEqual([]);
    expect(bigMoveAlert({ symbol: 'AVGO', price: 100, changePercent: null, held: true, session: 'regular', firedKeys: new Set(), day: '2026-10-16' })).toBeNull();
  });
});

describe('CNN 多档合并与开仓线同源', () => {
  const day = '2026-10-16';

  it('一次跨过 30、25、20 三档只写一行，用最深那一档', () => {
    const alerts = cnnAlerts({ score: 19, previousScore: null, firedKeys: new Set(), day });
    const tiers = alerts.filter((alert) => alert.kind === 'tier');
    expect(tiers).toHaveLength(1);
    expect(tiers[0].tier).toBe(20);
    expect(tiers[0].dedupe_key).toBe(`cnn-tier:20:${day}`);
    expect(tiers[0].text).toBe('CNN 恐惧贪婪 19 · 跌破 30 / 25 / 20 · 极度恐惧');
  });

  it('已经在档下待着时，不论浅档深档都不再补记', () => {
    const states = cnnTierStates(19, {});
    const alerts = cnnAlerts({ score: 19, previousScore: 19, firedKeys: new Set(), day, tierStates: states });
    expect(alerts.filter((alert) => alert.kind === 'tier')).toEqual([]);
  });

  it('档位状态按读数翻转：跌到档下记 below，回到档上记 above', () => {
    expect(cnnTierStates(19, {})).toMatchObject({
      'cnn-tier:30': 'below', 'cnn-tier:25': 'below', 'cnn-tier:20': 'below', 'cnn-tier:15': 'above',
    });
    expect(cnnTierStates(33, cnnTierStates(19, {}))).toMatchObject({
      'cnn-tier:30': 'above', 'cnn-tier:25': 'above', 'cnn-tier:20': 'above',
    });
    // 没有读数时原样返回，不猜
    const previous = cnnTierStates(19, {});
    expect(cnnTierStates(null, previous)).toBe(previous);
  });

  it('「到达开仓线」已经记过时，不再单独写一条「跌破 30」', () => {
    const alerts = cnnAlerts({ score: 28, previousScore: null, firedKeys: new Set(), day, floorReported: true });
    expect(alerts.filter((alert) => alert.kind === 'tier')).toEqual([]);
  });

  it('开仓线记过之后，更深的档位照常写，文案里不带已经报过的 30', () => {
    const alerts = cnnAlerts({ score: 19, previousScore: 28, firedKeys: new Set(), day, floorReported: true });
    const tiers = alerts.filter((alert) => alert.kind === 'tier');
    expect(tiers).toHaveLength(1);
    expect(tiers[0].tier).toBe(20);
    expect(tiers[0].text).toBe('CNN 恐惧贪婪 19 · 跌破 25 / 20 · 极度恐惧');
  });

  it('第一次运行没有上一次读数时，不写任何变化提醒', () => {
    const alerts = cnnAlerts({ score: 21, previousScore: null, firedKeys: new Set(), day });
    expect(alerts.some((alert) => alert.kind === 'relief' || alert.kind === 'deeper')).toBe(false);
    expect(alerts.every((alert) => !alert.text.includes('较上次 0'))).toBe(true);
  });
});

describe('CNN 开仓线那条状态提醒', () => {
  it('带上时段标签，和其他实时提醒一致', () => {
    expect(cnnFloorText(18.4, 'pre')).toBe('[盘前] CNN 恐惧贪婪 18 < 30 · 到达开仓线');
    expect(cnnFloorText(30.2, 'regular')).toBe('[盘中] CNN 恐惧贪婪 30 回到 30 以上 · 离开开仓线');
    expect(cnnFloorText(31, 'closed')).toBe('[休市] CNN 恐惧贪婪 31 回到 30 以上 · 离开开仓线');
  });
});

describe('接近露头（买入方向）', () => {
  const series = (zs: Array<number | null>) => zs.map((z, index) => ({
    date: `2026-09-${String(index + 1).padStart(2, '0')}`,
    zscore200: z,
    is_partial: false,
  }));

  it('只数最后一段连续在 0 以下的完整收盘交易日', () => {
    expect(negativeStreak(series([-0.5, -0.4, -0.3]))).toBe(3);
    expect(negativeStreak(series([-0.5, 0.2, -0.3, -0.2]))).toBe(2);
    expect(negativeStreak(series([0.1, 0.2]))).toBe(0);
    expect(negativeStreak(series([-0.5, null, -0.3]))).toBe(1);
    // 未收盘那根不算
    expect(negativeStreak([...series([-0.5, -0.4]), { date: '2026-09-03', zscore200: -0.05, is_partial: true }])).toBe(2);
  });

  it('连续 15 天以上在 0 以下、回升到 -0.1 以上时提醒一次', () => {
    const alerts = nearBreakoutAlerts({
      symbol: 'GOOG', price: 335.2, previousZ: -0.12, currentZ: -0.09, streak: 35,
      session: 'regular', states: {}, day: '2026-10-21',
    });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: 'near_breakout', category: 'zscore', symbol: 'GOOG', icon: '📈', level: 'normal',
      dedupe_key: 'near-breakout:GOOG:2026-10-21',
    });
    expect(alerts[0].text).toBe('[盘中] GOOG $335.20 · Z -0.12 → -0.09 · 接近向上露头（之前 35 天在 0 以下）· 可以去看看是否买入');
  });

  it('收盘再确认一次，标 [收盘确认]', () => {
    const [alert] = nearBreakoutAlerts({
      symbol: 'GOOG', price: 335.2, previousZ: -0.12, currentZ: -0.09, streak: 35,
      session: 'post', states: {}, day: '2026-10-21', confirmation: true,
    });

    expect(alert.text).toContain('[收盘确认]');
    expect(alert.dedupe_key).toBe('near-breakout-confirm:GOOG:2026-10-21');
  });

  it('同一轮只提醒一次：状态已经标过就不再提醒', () => {
    const states = { [nearBreakoutStateKey('GOOG')]: 'fired' };
    expect(nearBreakoutAlerts({
      symbol: 'GOOG', price: 335.2, previousZ: -0.12, currentZ: -0.09, streak: 35,
      session: 'regular', states, day: '2026-10-21',
    })).toEqual([]);
  });

  it('不够 15 天、还没回到 -0.1、或已经穿过 0 的都不提醒', () => {
    const base = { symbol: 'GOOG', price: 335.2, previousZ: -0.3, session: 'regular' as const, states: {}, day: '2026-10-21' };
    expect(nearBreakoutAlerts({ ...base, currentZ: -0.09, streak: 14 })).toEqual([]);
    expect(nearBreakoutAlerts({ ...base, currentZ: -0.2, streak: 35 })).toEqual([]);
    // 真的穿过 0 交给现有的「向上露头」
    expect(nearBreakoutAlerts({ ...base, currentZ: 0.05, streak: 35 })).toEqual([]);
  });

  it('Z 跌回 -0.5 以下才重置，之间来回不会重复刷屏', () => {
    const fired = { [nearBreakoutStateKey('WMT')]: 'fired' };
    // -0.058 这种来回：状态还在 fired，不重置也不再提醒
    expect(nearBreakoutStates(fired, { symbol: 'WMT', currentZ: -0.058 }))
      .toEqual(fired);
    expect(nearBreakoutStates(fired, { symbol: 'WMT', currentZ: -0.52 }))
      .toEqual({});
    // 提醒之后标记为已提醒
    expect(nearBreakoutStates({}, { symbol: 'WMT', currentZ: -0.09, fired: true }))
      .toEqual({ [nearBreakoutStateKey('WMT')]: 'fired' });
  });

  it('阈值写明白：15 个交易日、-0.1 触发、-0.5 重置', () => {
    expect(NEAR_BREAKOUT_MIN_SESSIONS).toBe(15);
    expect(NEAR_BREAKOUT_LEVEL).toBe(-0.1);
    expect(NEAR_BREAKOUT_RESET).toBe(-0.5);
  });
});

