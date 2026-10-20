import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOISE_CONFIG, STATUS_STATE_PREFIX, loadNoiseConfig, planSlotEntries, statusKeyOf, withinCooldown,
} from './alert-noise.mjs';

const NOW = new Date('2026-10-20T13:20:00Z');

function valuationEvent(symbol: string, zone = 'low') {
  return {
    key: `valuation:${symbol}:${zone}`,
    title: `🟢 ${symbol} · 低估值 · $333.88`,
    body: '远期 PE 22.60；按计划分批买入或继续持有。',
    category: 'valuation',
    symbol,
    pushed: false,
    push_state: 'category_disabled',
  };
}

describe('状态类提醒只在刚进入时记一条', () => {
  it('认得出「可买 / 低估值」这类状态提醒，别的不算', () => {
    expect(statusKeyOf('valuation:AVGO:low')).toBe('valuation:AVGO:low');
    expect(statusKeyOf('valuation:MCD:extreme_low')).toBe('valuation:MCD:extreme_low');
    // 估值事件的 key 末尾还带当天日期，状态要忽略日期那一段
    expect(statusKeyOf('valuation:AVGO:low:2026-10-20')).toBe('valuation:AVGO:low');
    expect(statusKeyOf('buy:NKE:2026-10-20')).toBe('buy:NKE');
    expect(statusKeyOf('z-cross:UDOW:0.5:up:2026-10-20')).toBeNull();
    expect(statusKeyOf('sell:NVDA:line')).toBeNull();
    expect(statusKeyOf('')).toBeNull();
  });

  it('第一次进入状态写单独一行，第二天还在同一状态就并进汇总', () => {
    const events = ['AVGO', 'MCD', 'META'].map((symbol) => valuationEvent(symbol));

    const first = planSlotEntries({
      store: { states: {}, alerts: [] }, events, now: NOW, slot: '2026-10-20:premarket', session: 'pre',
    });
    expect(first.entries).toHaveLength(3);
    expect(first.entries.every((entry) => entry.dedupe_key.startsWith('push:2026-10-20:premarket:'))).toBe(true);
    expect(first.states[`${STATUS_STATE_PREFIX}valuation:AVGO:low`]).toBe('in');

    const second = planSlotEntries({
      store: { states: first.states, alerts: [] }, events, now: new Date('2026-10-21T13:20:00Z'),
      slot: '2026-10-21:premarket', session: 'pre',
    });
    expect(second.entries).toHaveLength(1);
    const [summary] = second.entries;
    expect(summary.dedupe_key).toBe('summary:2026-10-21:premarket:valuation');
    expect(summary.text).toContain('估值汇总 · 3 个标的');
    expect(summary.summary_items?.map((item) => item.symbol)).toEqual(['AVGO', 'MCD', 'META']);
    expect(summary.summary_items?.[0].text).toContain('低估值');
  });

  it('离开状态后再进入，算新的一次，重新写单独一行', () => {
    const states = planSlotEntries({
      store: { states: {}, alerts: [] }, events: [valuationEvent('AVGO')], now: NOW,
      slot: '2026-10-20:premarket', session: 'pre',
    }).states;

    // 第二天 AVGO 已经不在低估值名单里：这一轮没有它的事件，状态要清掉
    const away = planSlotEntries({
      store: { states, alerts: [] }, events: [valuationEvent('MCD')], now: NOW,
      slot: '2026-10-21:premarket', session: 'pre',
    });
    expect(away.states[`${STATUS_STATE_PREFIX}valuation:AVGO:low`]).toBeUndefined();

    const back = planSlotEntries({
      store: { states: away.states, alerts: [] }, events: [valuationEvent('AVGO')], now: NOW,
      slot: '2026-10-22:premarket', session: 'pre',
    });
    expect(back.entries).toHaveLength(1);
    expect(back.entries[0].dedupe_key).toContain('push:2026-10-22:premarket:valuation:AVGO:low');
  });

  it('换了档位（低估值 → 极低估值）算新状态，单独记一行', () => {
    const first = planSlotEntries({
      store: { states: {}, alerts: [] }, events: [valuationEvent('NVDA', 'low')], now: NOW,
      slot: '2026-10-20:premarket', session: 'pre',
    });
    const second = planSlotEntries({
      store: { states: first.states, alerts: [] }, events: [valuationEvent('NVDA', 'extreme_low')],
      now: NOW, slot: '2026-10-21:premarket', session: 'pre',
    });
    expect(second.entries).toHaveLength(1);
    expect(second.entries[0].dedupe_key).toContain('valuation:NVDA:extreme_low');
  });

  it('不是状态类的提醒照旧单独记，不进汇总', () => {
    const plan = planSlotEntries({
      store: { states: {}, alerts: [] },
      events: [{ key: 'sell:NVDA:line', title: '🔴 NVDA · 到卖出线', body: '', category: 'sell_line', symbol: 'NVDA' }],
      now: NOW, slot: '2026-10-20:premarket', session: 'pre',
    });
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].dedupe_key).toBe('push:2026-10-20:premarket:sell:NVDA:line');
  });

  it('同一时间同一类的多条，合并成一行并带上明细', () => {
    const states = Object.fromEntries(['AVGO', 'MCD', 'META', 'NVDA', 'PDD']
      .map((symbol) => [`${STATUS_STATE_PREFIX}valuation:${symbol}:low`, 'in']));
    const plan = planSlotEntries({
      store: { states, alerts: [] },
      events: ['AVGO', 'MCD', 'META', 'NVDA', 'PDD'].map((symbol) => valuationEvent(symbol)),
      now: NOW, slot: '2026-10-21:premarket', session: 'pre',
    });
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].text).toContain('5 个标的');
    expect(plan.entries[0].summary_items).toHaveLength(5);
    expect(plan.entries[0].category).toBe('valuation');
    expect(plan.entries[0].indicators?.level).toBe(3);
  });
});

describe('同标的同类提醒的冷却时间', () => {
  const store = {
    alerts: [{
      dedupe_key: 'z-cross:UDOW:0.5:up:2026-10-20', symbol: 'UDOW', category: 'zscore',
      occurred_at: '2026-10-20T13:00:00Z', push_state: 'log_only', indicators: { level: 3 },
    }],
  };

  it('60 分钟内同标的同类的第二条被挡下', () => {
    expect(withinCooldown(store, {
      symbol: 'UDOW', category: 'zscore', now: new Date('2026-10-20T13:30:00Z'), cooldownMs: 3_600_000,
    })).toBe(true);
  });

  it('超过 60 分钟就放行', () => {
    expect(withinCooldown(store, {
      symbol: 'UDOW', category: 'zscore', now: new Date('2026-10-20T14:30:00Z'), cooldownMs: 3_600_000,
    })).toBe(false);
  });

  it('换标的或换类别都不受上一条影响', () => {
    const at = new Date('2026-10-20T13:30:00Z');
    expect(withinCooldown(store, { symbol: 'GDX', category: 'zscore', now: at, cooldownMs: 3_600_000 })).toBe(false);
    expect(withinCooldown(store, { symbol: 'UDOW', category: 'sell_line', now: at, cooldownMs: 3_600_000 })).toBe(false);
  });

  it('没有标的的提醒（系统类）不做冷却', () => {
    expect(withinCooldown(store, {
      symbol: null, category: 'system', now: new Date('2026-10-20T13:30:00Z'), cooldownMs: 3_600_000,
    })).toBe(false);
  });

  it('已经真的推送出去的那条不算进冷却，推送记录不能被挡掉', () => {
    const pushed = { alerts: [{ ...store.alerts[0], push_state: 'sent' }] };
    expect(withinCooldown(pushed, {
      symbol: 'UDOW', category: 'zscore', now: new Date('2026-10-20T13:30:00Z'), cooldownMs: 3_600_000,
    })).toBe(false);
  });
});

describe('降噪配置写在配置文件里', () => {
  it('默认 60 分钟冷却，重要提醒不受冷却限制', () => {
    expect(DEFAULT_NOISE_CONFIG.cooldownMinutes).toBe(60);
    expect(DEFAULT_NOISE_CONFIG.importantBypassesCooldown).toBe(true);
  });

  it('读不到配置或配置写坏了都退回默认值', () => {
    expect(loadNoiseConfig(null)).toEqual(DEFAULT_NOISE_CONFIG);
    expect(loadNoiseConfig({ cooldownMinutes: 'abc' })).toEqual(DEFAULT_NOISE_CONFIG);
    expect(loadNoiseConfig({ cooldownMinutes: 15 }).cooldownMinutes).toBe(15);
    expect(loadNoiseConfig({ cooldownMinutes: -5 })).toEqual(DEFAULT_NOISE_CONFIG);
  });
});
