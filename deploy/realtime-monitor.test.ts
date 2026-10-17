import { describe, expect, it, vi } from 'vitest';
import { emptyAlertLog } from './alert-log.mjs';
import { realtimeDefaults } from './realtime-push.mjs';
import { feedStateReading, intradayZPreview, monitorSymbols, runRealtimeTick } from './realtime-monitor.mjs';

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
    expect(result.store.alerts.some((item) => item.push_state === 'quiet_hours')).toBe(true);
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
      sellLines: { AVGO: { trigger: 446.56, reference: 447.1, label: '正股分批' } },
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

describe('数据源中断提醒', () => {
  const lastOkAt = Date.parse('2026-10-16T18:00:00.000Z');

  it('断超过 10 分钟报一条 ❗，并说明实时提醒暂停', () => {
    const reading = feedStateReading({ lastOkAt, now: new Date('2026-10-16T18:12:00.000Z') });

    expect(reading).toMatchObject({ key: 'realtime-feed', state: 'triggered', category: 'system', icon: '❗' });
    expect(reading!.text).toContain('12 分钟');
    expect(reading!.text).toContain('实时提醒暂停');
  });

  it('没断或刚断几分钟都算正常', () => {
    expect(feedStateReading({ lastOkAt, now: new Date('2026-10-16T18:05:00.000Z') })!.state).toBe('normal');
    expect(feedStateReading({ lastOkAt, now: new Date('2026-10-16T18:00:30.000Z') })!.state).toBe('normal');
  });

  it('恢复后的那条写清楚断了多久', () => {
    const reading = feedStateReading({ lastOkAt: Date.parse('2026-10-16T18:20:00.000Z'), now: new Date('2026-10-16T18:20:05.000Z'), outageMinutes: 14 });

    expect(reading).toMatchObject({ state: 'normal', icon: '✅' });
    expect(reading!.text).toContain('恢复');
  });

  it('还没成功取过价时不报警', () => {
    expect(feedStateReading({ lastOkAt: null, now: new Date('2026-10-16T18:12:00.000Z') })).toBeNull();
  });
});

describe('实时卖出线必须过合理性校验', () => {
  const sellBase = {
    ...base,
    session: 'regular',
    now: new Date('2026-10-16T17:54:38.479Z'),
    quotes: { TSLA: { price: 353.18, previousClose: 362.44, changePercent: -0.0256 } },
  };

  it('卖出线低于现价一半时一条都不写（TSLA $31.41 回放）', async () => {
    const result = await runRealtimeTick({
      ...sellBase,
      store: emptyAlertLog(),
      sellLines: { TSLA: { trigger: 31.41, reference: 353.18, label: '开始降风险' } },
    });
    expect(result.alerts.filter((alert) => alert.kind === 'sell_line')).toEqual([]);
  });

  it('没有基准价时跳过，不拿来提醒', async () => {
    const result = await runRealtimeTick({
      ...sellBase,
      store: emptyAlertLog(),
      sellLines: { TSLA: { trigger: 31.41, reference: null, label: '开始降风险' } },
    });
    expect(result.alerts.filter((alert) => alert.kind === 'sell_line')).toEqual([]);
  });

  it('合理的卖出线照常提醒', async () => {
    const result = await runRealtimeTick({
      ...sellBase,
      store: emptyAlertLog(),
      sellLines: { TSLA: { trigger: 350, reference: 353.18, label: '开始降风险' } },
    });
    const line = result.alerts.find((alert) => alert.kind === 'sell_line');
    expect(line?.text).toBe('[盘中] TSLA $353.18 ≥ 卖出线 $350.00 · 开始降风险');
  });
});

describe('盘中 Z 用决策页「盘中预览」同一口径', () => {
  const dashboard = (series: unknown[]) => ({ dashboard: { band_sigma: 1.5, series } });

  it('取未收盘那根的 zscore200 当现值，最后一根完整收盘当起点', () => {
    const reading = intradayZPreview(dashboard([
      { date: '2026-10-15', close: 362.44, zscore200: -0.749115, is_partial: false },
      { date: '2026-10-16', close: 353.14, zscore200: -1.0122, is_partial: true },
    ]));
    expect(reading).toEqual({ previousZ: -0.749115, currentZ: -1.0122, price: 353.14, date: '2026-10-16' });
  });

  it('没有盘中日线时返回 null，不拿收盘价当盘中价', () => {
    expect(intradayZPreview(dashboard([
      { date: '2026-10-16', close: 354.72, zscore200: -0.963323, is_partial: false },
    ]))).toBeNull();
    expect(intradayZPreview(null)).toBeNull();
  });

  it('TSLA 从 -0.75 跌到 -1.01 时写一行「跌得更深」，再跑一次不重复', async () => {
    const reading = intradayZPreview(dashboard([
      { date: '2026-10-15', close: 362.44, zscore200: -0.749115, is_partial: false },
      { date: '2026-10-16', close: 353.14, zscore200: -1.0122, is_partial: true },
    ]));
    const first = await runRealtimeTick({
      ...base, session: 'regular', now: new Date('2026-10-16T17:54:38.479Z'),
      store: emptyAlertLog(), quotes: {}, intradayZ: { TSLA: reading },
    });
    const crossed = first.alerts.filter((alert) => alert.kind === 'z_cross');
    expect(crossed).toHaveLength(1);
    expect(crossed[0].text).toContain('TSLA');
    expect(crossed[0].text).toContain('Z -0.75 → -1.01');
    expect(crossed[0].text).toContain('跌得更深');

    const second = await runRealtimeTick({
      ...base, session: 'regular', now: new Date('2026-10-16T17:56:38.479Z'),
      store: first.store, quotes: {}, intradayZ: { TSLA: reading },
    });
    expect(second.alerts.filter((alert) => alert.kind === 'z_cross')).toEqual([]);
  });
});

describe('日志记下推送到底有没有发出去', () => {
  const pushBase = { ...base, session: 'regular', now: new Date('2026-10-16T17:54:38.479Z'), store: emptyAlertLog() };

  it('开关没开时写「未推送 · 实时提醒未开」的状态', async () => {
    const result = await runRealtimeTick({ ...pushBase });
    expect(result.entries[0].push_state).toBe('realtime_disabled');
  });

  it('免打扰期间写 quiet_hours', async () => {
    const result = await runRealtimeTick({
      ...pushBase,
      settings: { ...realtimeDefaults(), enabled: true, qqqDrawdown: true, vix: true, cnn: true },
      quiet: true,
    });
    expect(result.entries[0].push_state).toBe('quiet_hours');
  });

  it('真发出去时写 sent 和连发次数', async () => {
    const result = await runRealtimeTick({
      ...pushBase,
      settings: { ...realtimeDefaults(), enabled: true, qqqDrawdown: true, vix: true, cnn: true, importantRepeat: 3 },
      dispatch: async () => ({ status: 'sent' }),
    });
    const important = result.entries.find((entry) => entry.push_state === 'sent');
    expect(important?.push_repeat).toBe(3);
  });
});

describe('「到达开仓线」和「跌破 30」算同一个事件', () => {
  it('开仓线已经记过时，这一轮不再写「跌破 30」', async () => {
    const result = await runRealtimeTick({
      ...base, session: 'regular', now: new Date('2026-10-16T17:54:38.479Z'),
      store: emptyAlertLog(), quotes: {}, cnnScore: 28, previousCnnScore: null,
      cnnFloorReported: true,
    });
    expect(result.alerts.filter((alert) => alert.category === 'sentiment')).toEqual([]);
  });

  it('开仓线没记过时照常写一行', async () => {
    const result = await runRealtimeTick({
      ...base, session: 'regular', now: new Date('2026-10-16T17:54:38.479Z'),
      store: emptyAlertLog(), quotes: {}, cnnScore: 28, previousCnnScore: null,
    });
    expect(result.alerts.some((alert) => alert.text.includes('跌破 30'))).toBe(true);
  });
});

describe('休市日不重复记涨跌类提醒', () => {
  // 周五的行情：VIX 较昨收 +21%、QQQ -2.8%、AVL -7.8%，卖出线也到了
  const friday = {
    ...base,
    session: 'regular',
    now: new Date('2026-10-16T17:54:38Z'),
    cnnScore: 21,
    previousCnnScore: 28,
    quotes: {
      QQQ: { price: 707.87, previousClose: 728, changePercent: -0.028 },
      VIX: { price: 19.98, previousClose: 16.46, changePercent: 0.214 },
      AVL: { price: 31.26, previousClose: 33.9, changePercent: -0.078 },
    },
    heldSymbols: ['AVL'],
    sellLines: { AVL: { trigger: 31, reference: 31.26, label: '开始降风险' } },
  };

  it('周五先记一轮', async () => {
    const result = await runRealtimeTick({ ...friday, store: emptyAlertLog() });
    const kinds = result.alerts.map((alert) => alert.kind);
    expect(kinds).toContain('rise');
    expect(kinds).toContain('big_move');
    expect(kinds).toContain('drawdown');
    expect(kinds).toContain('sell_line');
  });

  it('周六、周日同一份行情一条都不再记', async () => {
    const first = await runRealtimeTick({ ...friday, store: emptyAlertLog() });

    const saturday = await runRealtimeTick({
      ...friday, session: 'closed', now: new Date('2026-10-17T04:10:24Z'), store: first.store,
    });
    const sunday = await runRealtimeTick({
      ...friday, session: 'closed', now: new Date('2026-10-18T16:00:00Z'), store: saturday.store,
    });

    expect(saturday.alerts).toEqual([]);
    expect(sunday.alerts).toEqual([]);
    expect(sunday.store.alerts.length).toBe(first.store.alerts.length);
  });

  it('周一有新的涨跌才重新记', async () => {
    const first = await runRealtimeTick({ ...friday, store: emptyAlertLog() });
    const monday = await runRealtimeTick({
      ...friday,
      session: 'regular',
      now: new Date('2026-10-19T14:00:00Z'),
      store: first.store,
    });

    expect(monday.alerts.map((alert) => alert.kind)).toContain('big_move');
  });

  it('休市日仍然检查 CNN', async () => {
    const result = await runRealtimeTick({
      ...friday,
      session: 'closed',
      now: new Date('2026-10-17T04:10:24Z'),
      store: emptyAlertLog(),
      cnnScore: 18,
      previousCnnScore: 28,
    });

    expect(result.alerts.length).toBeGreaterThan(0);
    expect([...new Set(result.alerts.map((alert) => alert.symbol))]).toEqual(['CNN']);
  });
});

describe('CNN 档位按状态穿越记', () => {
  const at = (overrides: Record<string, unknown> = {}) => ({
    ...base, session: 'regular', now: new Date('2026-10-16T17:54:38Z'), quotes: {}, ...overrides,
  });

  it('跌破一档记一次，继续待在下面不再记', async () => {
    const first = await runRealtimeTick(at({ store: emptyAlertLog(), cnnScore: 18, previousCnnScore: 28 }));
    expect(first.alerts.filter((alert) => alert.kind === 'tier')).toHaveLength(1);

    const second = await runRealtimeTick(at({
      store: first.store, cnnScore: 17, previousCnnScore: 18, now: new Date('2026-10-16T18:30:00Z'),
    }));
    expect(second.alerts.filter((alert) => alert.kind === 'tier')).toEqual([]);

    // 换一天日历日期也不会再记，因为状态没变
    const nextDay = await runRealtimeTick(at({
      store: second.store, cnnScore: 18, previousCnnScore: 17, now: new Date('2026-10-19T14:00:00Z'),
    }));
    expect(nextDay.alerts.filter((alert) => alert.kind === 'tier')).toEqual([]);
  });

  it('回到档位上方再跌回去，才重新记一次', async () => {
    const first = await runRealtimeTick(at({ store: emptyAlertLog(), cnnScore: 18, previousCnnScore: 28 }));
    const recovered = await runRealtimeTick(at({
      store: first.store, cnnScore: 33, previousCnnScore: 18, now: new Date('2026-10-19T14:00:00Z'),
    }));
    const dropped = await runRealtimeTick(at({
      store: recovered.store, cnnScore: 18, previousCnnScore: 33, now: new Date('2026-10-20T14:00:00Z'),
    }));

    expect(dropped.alerts.filter((alert) => alert.kind === 'tier')).toHaveLength(1);
  });
});
