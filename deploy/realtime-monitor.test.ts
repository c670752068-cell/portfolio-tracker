import { describe, expect, it, vi } from 'vitest';
import { emptyAlertLog } from './alert-log.mjs';
import { realtimeDefaults } from './realtime-push.mjs';
import { intradayZFromDashboard, monitorSymbols, runRealtimeTick } from './realtime-monitor.mjs';

const base = {
  now: new Date('2026-10-17T01:30:00.000Z'), // 美东 21:30 → 夜盘
  session: 'overnight',
  qqqPreviousHigh: 759.66,
  qqqPeakDate: '2026-10-15',
  cnnScore: 18,
  previousCnnScore: 28,
  quotes: {
    QQQ: { price: 712.3, previousClose: 721.53, changePercent: -0.0128, session: 'overnight' },
    VIX: { price: 21.96, previousClose: 16.46, changePercent: 0.334, session: 'overnight' },
  },
  intradayZ: {},
  sellLines: {},
  heldSymbols: [],
  settings: realtimeDefaults(),
};

describe('实时监控的一次轮询', () => {
  it('夜盘 QQQ -6.2%：写回撤、VIX 飙升、CNN 恐慌和共振，默认不推送', async () => {
    const dispatch = vi.fn();
    const result = await runRealtimeTick({ ...base, store: emptyAlertLog(), dispatch });

    const texts = result.alerts.map((item) => item.text);
    expect(texts.some((text) => text.includes('[夜盘]') && text.includes('本轮首次跌破 -5%'))).toBe(true);
    expect(texts.some((text) => text.includes('VIX') && text.includes('波动率飙升'))).toBe(true);
    expect(texts.some((text) => text.includes('CNN 恐惧贪婪 18'))).toBe(true);
    expect(texts.some((text) => text.includes('多指标共振'))).toBe(true);
    // 默认全部关闭：只写日志，不推送
    expect(dispatch).not.toHaveBeenCalled();
    expect(result.store.alerts.every((item) => item.pushed === false)).toBe(true);
  });

  it('同一轮再跑一次不会重复写', async () => {
    const first = await runRealtimeTick({ ...base, store: emptyAlertLog(), dispatch: vi.fn() });
    const second = await runRealtimeTick({ ...base, store: first.store, dispatch: vi.fn() });

    expect(second.alerts).toEqual([]);
    expect(second.store.alerts).toHaveLength(first.store.alerts.length);
  });

  it('开关打开后重要提醒连发 3 条，试运行模式不真发', async () => {
    const dispatch = vi.fn().mockResolvedValue({ status: 'sent' });
    const settings = { ...realtimeDefaults(), enabled: true, qqqDrawdown: true, vix: true, cnn: true, resonance: true };

    const dry = await runRealtimeTick({ ...base, store: emptyAlertLog(), settings, dispatch, dryRun: true });
    expect(dispatch).not.toHaveBeenCalled();
    expect(dry.dryRunPushes.filter((item) => item.level === 'important').length).toBeGreaterThan(0);
    expect(dry.dryRunPushes.find((item) => item.level === 'important')!.repeat).toBe(3);
    expect(dry.store.alerts.every((item) => item.text.includes('[测试]'))).toBe(true);

    const real = await runRealtimeTick({ ...base, store: emptyAlertLog(), settings, dispatch });
    expect(dispatch).toHaveBeenCalled();
    const titles = dispatch.mock.calls.map((call) => call[0].title);
    expect(titles.some((title: string) => title.includes('重要 1/3'))).toBe(true);
    expect(titles.some((title: string) => title.includes('重要 3/3'))).toBe(true);
    expect(real.store.alerts.some((item) => item.pushed === true)).toBe(true);
  });

  it('免打扰期间只记日志，重要的排进汇总', async () => {
    const dispatch = vi.fn().mockResolvedValue({ status: 'quiet_hours' });
    const settings = { ...realtimeDefaults(), enabled: true, qqqDrawdown: true };
    const result = await runRealtimeTick({ ...base, store: emptyAlertLog(), settings, dispatch, quiet: true });

    expect(dispatch).not.toHaveBeenCalled();
    expect(result.quietQueue.length).toBeGreaterThan(0);
    expect(result.store.alerts.some((item) => item.text.includes('[免打扰]'))).toBe(true);
  });

  it('盘中 Z 从 -0.75 到 -1.01 写一行「跌得更深」', async () => {
    const result = await runRealtimeTick({
      ...base,
      session: 'regular',
      intradayZ: { TSLA: { previousZ: -0.75, currentZ: -1.01, price: 353.14 } },
      store: emptyAlertLog(),
      dispatch: vi.fn(),
    });

    expect(result.alerts.some((item) => item.text.includes('TSLA') && item.text.includes('跌得更深'))).toBe(true);
  });

  it('实时价格到卖出线写一行重要提醒', async () => {
    const result = await runRealtimeTick({
      ...base,
      session: 'post',
      quotes: { ...base.quotes, AVGO: { price: 447.1, previousClose: 441, changePercent: 0.014, session: 'post' } },
      sellLines: { AVGO: { trigger: 446.56, label: '正股分批' } },
      heldSymbols: ['AVGO'],
      store: emptyAlertLog(),
      dispatch: vi.fn(),
    });

    const hit = result.alerts.find((item) => item.kind === 'sell_line');
    expect(hit).toMatchObject({ level: 'important', symbol: 'AVGO' });
    expect(hit!.text).toContain('卖出线');
  });

  it('监控范围 = QQQ + VIX + 持仓 + 决策标的，有上限', () => {
    const symbols = monitorSymbols({
      held: ['AVGO', 'TSLA'],
      decision: Array.from({ length: 50 }, (_, index) => `S${index}`),
    });

    expect(symbols[0]).toBe('QQQ');
    expect(symbols).toContain('VIX');
    expect(symbols).toContain('AVGO');
    expect(symbols.length).toBeLessThanOrEqual(24);
    expect(new Set(symbols).size).toBe(symbols.length);
  });
});

describe('盘中 Z 用现价和已收盘的通道算', () => {
  const dashboard = {
    dashboard: {
      band_sigma: 1.5,
      series: [
        { date: '2026-10-14', close: 360, ma200: 380, band200: [350, 410], zscore200: -1.0, is_partial: false },
        { date: '2026-10-15', close: 362.44, ma200: 380, band200: [350, 410], zscore200: -0.75, is_partial: false },
        { date: '2026-10-16', close: 355, ma200: 380, band200: [350, 410], zscore200: -0.9, is_partial: true },
      ],
    },
  };

  it('用最后一根完整收盘的均线和带宽，把现价折成 Z', () => {
    const reading = intradayZFromDashboard(dashboard, 353.14);

    expect(reading).not.toBeNull();
    expect(reading!.previousZ).toBeCloseTo(-0.75, 6);
    // (353.14 - 380) / ((410 - 380) / 1.5) = -1.343
    expect(reading!.currentZ).toBeCloseTo(-1.343, 2);
    expect(reading!.price).toBe(353.14);
  });

  it('缺数据就返回空，不猜', () => {
    expect(intradayZFromDashboard(null, 100)).toBeNull();
    expect(intradayZFromDashboard(dashboard, null)).toBeNull();
    expect(intradayZFromDashboard({ dashboard: { series: [] } }, 100)).toBeNull();
  });
});
