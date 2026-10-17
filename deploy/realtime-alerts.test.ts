import { describe, expect, it } from 'vitest';
import {
  QQQ_BIG_MOVE_PCT, RESONANCE_HISTORY_NOTE, SESSION_CADENCE_MS, STOCK_BIG_MOVE_PCT,
  bigMoveAlert, cnnAlerts, intradayZAlerts, qqqRealtimeAlerts, resonanceAlert,
  sessionLabel, vixAlerts,
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

  it('同一档同一方向一天只记一次，没穿档不记', () => {
    const fired = new Set(['z-cross:TSLA:-1:down:2026-10-16']);
    expect(intradayZAlerts({ symbol: 'TSLA', price: 1, previousZ: -0.75, currentZ: -1.01, session: 'regular', firedKeys: fired, day: '2026-10-16' })).toEqual([]);
    expect(intradayZAlerts({ symbol: 'TSLA', price: 1, previousZ: -0.75, currentZ: -0.8, session: 'regular', firedKeys: new Set(), day: '2026-10-16' })).toEqual([]);
  });
});

describe('个股大幅波动与多指标共振', () => {
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

  it('已经报过更深的档位后，不再回头补浅档', () => {
    const fired = new Set([`cnn-tier:20:${day}`]);
    const alerts = cnnAlerts({ score: 19, previousScore: 19, firedKeys: fired, day });
    expect(alerts.filter((alert) => alert.kind === 'tier')).toEqual([]);
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
