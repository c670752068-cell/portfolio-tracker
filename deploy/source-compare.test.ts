import { describe, expect, it } from 'vitest';
import {
  COMPARE_TOLERANCE, compareSnapshots, compareReadingForAlerts, comparePositions,
} from './source-compare.mjs';

const mac = {
  positions: [
    { symbol: 'QQQM', qty: 40, market_value: 11945.6 },
    { symbol: 'TQQQ', qty: 215, market_value: 15611.15 },
    { symbol: 'NVDA', qty: 20, market_value: 4439.4 },
  ],
  nav: 190_000,
  snapshot: { generated_at: '2026-10-25T10:00:00-04:00', qqq_drawdown_pct: -4.5, cnn: 32, ndx_pe: 30.04 },
};

describe('两边持仓逐项对比', () => {
  it('完全一致时没有差异', () => {
    expect(comparePositions(mac.positions, mac.positions)).toEqual([]);
  });

  it('数量对不上、市值差得多、某一边多出来的，都要列出来', () => {
    const server = [
      { symbol: 'QQQM', qty: 40, market_value: 11945.6 },
      { symbol: 'TQQQ', qty: 200, market_value: 14522.0 },
      { symbol: 'SOXL', qty: 30, market_value: 3097.2 },
    ];
    const diffs = comparePositions(mac.positions, server);

    expect(diffs.find((d) => d.symbol === 'TQQQ')).toMatchObject({ kind: 'qty', mac: 215, server: 200 });
    expect(diffs.find((d) => d.symbol === 'NVDA')).toMatchObject({ kind: 'missing_on_server' });
    expect(diffs.find((d) => d.symbol === 'SOXL')).toMatchObject({ kind: 'missing_on_mac' });
  });

  it('市值小幅波动（两边取价时间不同）不算差异', () => {
    const server = mac.positions.map((item) => ({ ...item, market_value: item.market_value * 1.003 }));
    expect(comparePositions(mac.positions, server)).toEqual([]);
    expect(COMPARE_TOLERANCE.marketValuePct).toBe(1);
  });
});

describe('净值与量化快照对比', () => {
  it('净值差超过阈值要报', () => {
    const same = compareSnapshots(mac, { ...mac, nav: 190_300 });
    expect(same.filter((d) => d.field === 'nav')).toEqual([]);

    const off = compareSnapshots(mac, { ...mac, nav: 185_000 });
    expect(off.find((d) => d.field === 'nav')).toMatchObject({ mac: 190_000, server: 185_000 });
  });

  it('回撤、CNN、纳指 PE 逐项比', () => {
    const diffs = compareSnapshots(mac, {
      ...mac,
      snapshot: { ...mac.snapshot, qqq_drawdown_pct: -6.1, cnn: 32, ndx_pe: 33.9 },
    });

    expect(diffs.map((d) => d.field).sort()).toEqual(['ndx_pe', 'qqq_drawdown_pct']);
  });

  it('某一边没有数就不比，写成「缺数据」', () => {
    const diffs = compareSnapshots(mac, { ...mac, snapshot: { ...mac.snapshot, cnn: null } });
    expect(diffs.find((d) => d.field === 'cnn')).toMatchObject({ kind: 'missing' });
  });
});

describe('对比结果变成系统提醒', () => {
  it('有差异就写一条「❗ 系统」，没有差异写「一致」', () => {
    const bad = compareReadingForAlerts([
      { kind: 'qty', symbol: 'TQQQ', mac: 215, server: 200 },
      { kind: 'value', field: 'nav', mac: 190_000, server: 185_000 },
    ]);

    expect(bad).toMatchObject({ key: 'source-compare', state: 'triggered', category: 'system', icon: '❗' });
    expect(bad.text).toContain('两边数据对不上');
    expect(bad.text).toContain('TQQQ');

    const good = compareReadingForAlerts([]);
    expect(good).toMatchObject({ state: 'normal', icon: '✅' });
    expect(good.text).toContain('一致');
  });

  it('差异很多时只列前几条，不把日志刷爆', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ kind: 'qty', symbol: `S${index}`, mac: 1, server: 2 }));
    const reading = compareReadingForAlerts(many);

    expect(reading.text).toContain('12 项');
    expect(reading.text.length).toBeLessThan(300);
  });
});
