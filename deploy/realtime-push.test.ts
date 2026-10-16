import { describe, expect, it } from 'vitest';
import {
  REALTIME_FLAG_BY_KIND, mergeRealtimeSettings, pushPlanFor, quietSummaryEvent, realtimeDefaults,
} from './realtime-push.mjs';

const important = { kind: 'drawdown', level: 'important', text: 'QQQ 跌破 -5%', category: 'drawdown' };
const normal = { kind: 'z_cross', level: 'normal', text: 'TSLA 跌得更深', category: 'zscore' };
const logOnly = { kind: 'big_move', level: 'log_only', text: 'MU 大涨', category: 'other' };

describe('实时推送的开关与分级', () => {
  it('所有新推送默认关闭，重要提醒默认连发 3 条', () => {
    const defaults = realtimeDefaults();

    expect(defaults.enabled).toBe(false);
    for (const flag of Object.values(REALTIME_FLAG_BY_KIND)) expect(defaults[flag]).toBe(false);
    expect(defaults.importantRepeat).toBe(3);
    expect(defaults.quietSummary).toBe(true);
  });

  it('总开关或分类开关关着就不推，只记日志', () => {
    const off = realtimeDefaults();
    expect(pushPlanFor(important, off, { quiet: false })).toMatchObject({ push: false, reason: 'realtime_disabled' });

    const onlyMaster = { ...off, enabled: true };
    expect(pushPlanFor(important, onlyMaster, { quiet: false })).toMatchObject({ push: false, reason: 'category_disabled' });
  });

  it('打开之后：重要连发 3 条，普通 1 条，仅记录不推', () => {
    const on = { ...realtimeDefaults(), enabled: true, qqqDrawdown: true, intradayZ: true, bigMove: true };

    expect(pushPlanFor(important, on, { quiet: false })).toMatchObject({ push: true, repeat: 3 });
    expect(pushPlanFor(normal, on, { quiet: false })).toMatchObject({ push: true, repeat: 1 });
    expect(pushPlanFor(logOnly, on, { quiet: false })).toMatchObject({ push: false, reason: 'log_only' });
  });

  it('连发次数可以改成 1 或 2', () => {
    const on = { ...realtimeDefaults(), enabled: true, qqqDrawdown: true, importantRepeat: 2 };
    expect(pushPlanFor(important, on, { quiet: false }).repeat).toBe(2);
  });

  it('免打扰期间只记日志，重要的排进汇总', () => {
    const on = { ...realtimeDefaults(), enabled: true, qqqDrawdown: true, intradayZ: true };

    expect(pushPlanFor(important, on, { quiet: true })).toMatchObject({ push: false, reason: 'quiet_hours', queueSummary: true });
    expect(pushPlanFor(normal, on, { quiet: true })).toMatchObject({ push: false, reason: 'quiet_hours', queueSummary: false });
  });

  it('免打扰结束时把重要提醒汇总成 1 条', () => {
    const event = quietSummaryEvent([
      { text: '[夜盘] QQQ 712.30 · 离前高 -6.2% · 本轮首次跌破 -5%' },
      { text: '[盘中] VIX 21.96 · 较昨收 +33.4% · 波动率飙升' },
      { text: 'CNN 恐惧贪婪 18 · 跌破 20 · 极度恐惧' },
    ], new Date('2026-10-17T00:05:00.000Z'));

    expect(event!.title).toContain('免打扰期间 3 条重要提醒');
    expect(event!.body).toContain('QQQ');
    expect(event!.body).toContain('VIX');
    expect(event!.body).toContain('CNN');
    expect(quietSummaryEvent([], new Date())).toBeNull();
  });

  it('老设置缺少 realtime 字段时补上默认值，不动其他设置', () => {
    const merged = mergeRealtimeSettings({ enabled: true, quietHours: { enabled: true } });

    expect(merged.realtime).toEqual(realtimeDefaults());
    expect(merged.enabled).toBe(true);
    expect(merged.quietHours).toEqual({ enabled: true });
  });
});
