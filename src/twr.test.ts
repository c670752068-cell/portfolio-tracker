import { describe, expect, it } from 'vitest';
import {
  blendedBenchmarkReturn, blendedMaxDrawdownPct, buildTwr, buyAndHoldReturn, maxDrawdownPct,
} from './twr';

const nav = (date: string, value: number) => ({ date, nav: value, captured_at: `${date}T20:00:00Z` });
const flow = (date: string, amount: number) => ({ id: `f-${date}`, date, amount, note: '', created_at: `${date}T20:00:00Z` });

describe('时间加权收益率', () => {
  it('没有出入金时就是净值涨幅', () => {
    const result = buildTwr([nav('2026-10-01', 100_000), nav('2026-10-02', 110_000)], []);

    expect(result.returnPct).toBeCloseTo(10, 6);
    expect(result.start).toBe('2026-10-01');
    expect(result.end).toBe('2026-10-02');
  });

  it('入金不算收益：净值 100k → 210k 但当天入金 100k，只算 +10%', () => {
    const result = buildTwr(
      [nav('2026-10-01', 100_000), nav('2026-10-02', 210_000)],
      [flow('2026-10-02', 100_000)],
    );

    expect(result.returnPct).toBeCloseTo(10, 6);
  });

  it('出金同样剔除：100k → 45k 且取走 50k，算 -5%', () => {
    const result = buildTwr(
      [nav('2026-10-01', 100_000), nav('2026-10-02', 45_000)],
      [flow('2026-10-02', -50_000)],
    );

    expect(result.returnPct).toBeCloseTo(-5, 6);
  });

  it('给出账户自己的最大回撤', () => {
    const result = buildTwr([
      nav('2026-10-01', 100_000), nav('2026-10-02', 120_000),
      nav('2026-10-03', 90_000), nav('2026-10-06', 110_000),
    ], []);

    expect(result.maxDrawdownPct).toBeCloseTo(-25, 6);
    expect(result.returnPct).toBeCloseTo(10, 6);
  });

  it('按月拆分，并能只算某个起点之后', () => {
    const series = [
      nav('2026-09-29', 100_000), nav('2026-09-30', 105_000),
      nav('2026-10-01', 105_000), nav('2026-10-30', 115_500),
    ];

    const all = buildTwr(series, []);
    expect(all.monthly).toEqual([
      { month: '2026-09', returnPct: expect.closeTo(5, 6) },
      { month: '2026-10', returnPct: expect.closeTo(10, 6) },
    ]);

    const october = buildTwr(series, [], { from: '2026-10-01' });
    expect(october.returnPct).toBeCloseTo(10, 6);
    expect(october.monthly).toHaveLength(1);
  });

  it('数据不足时返回空值，不猜', () => {
    expect(buildTwr([], []).returnPct).toBeNull();
    expect(buildTwr([nav('2026-10-01', 100_000)], []).returnPct).toBeNull();
    expect(buildTwr([nav('2026-10-01', 0), nav('2026-10-02', 100)], []).returnPct).toBeNull();
  });
});

describe('基准对比', () => {
  const qqq = [
    { date: '2026-09-30', close: 100 }, { date: '2026-10-30', close: 110 }, { date: '2026-11-30', close: 99 },
  ];
  const sgov = [
    { date: '2026-09-30', close: 100 }, { date: '2026-10-30', close: 100 }, { date: '2026-11-30', close: 100 },
  ];

  it('满仓 QQQ 就是区间涨幅', () => {
    expect(buyAndHoldReturn(qqq, '2026-09-30', '2026-11-30')).toBeCloseTo(-1, 6);
    expect(buyAndHoldReturn(qqq, '2026-09-30', '2026-10-30')).toBeCloseTo(10, 6);
    expect(buyAndHoldReturn(qqq, '2026-09-30', '2027-01-01')).toBeCloseTo(-1, 6);
    expect(buyAndHoldReturn([], '2026-09-30', '2026-11-30')).toBeNull();
  });

  it('60% QQQ + 40% SGOV 每月再平衡', () => {
    // 10 月 QQQ +10% → 组合 +6%；11 月 QQQ -10% → 组合 -6%
    const blended = blendedBenchmarkReturn(qqq, sgov, '2026-09-30', '2026-11-30', 0.6);

    expect(blended).toBeCloseTo((1.06 * 0.94 - 1) * 100, 6);
  });

  it('缺少任一基准序列就返回空值', () => {
    expect(blendedBenchmarkReturn(qqq, [], '2026-09-30', '2026-11-30', 0.6)).toBeNull();
  });
});

describe('基准的最大回撤', () => {
  const series = [
    { date: '2026-09-30', close: 100 }, { date: '2026-10-15', close: 120 },
    { date: '2026-10-30', close: 90 }, { date: '2026-11-30', close: 110 },
  ];
  const flat = series.map((point) => ({ date: point.date, close: 100 }));

  it('满仓基准按区间内的收盘序列算最大回撤', () => {
    expect(maxDrawdownPct(series, '2026-09-30', '2026-11-30')).toBeCloseTo(-25, 6);
    expect(maxDrawdownPct(flat, '2026-09-30', '2026-11-30')).toBeCloseTo(0, 6);
    expect(maxDrawdownPct([], '2026-09-30', '2026-11-30')).toBeNull();
  });

  it('混合基准按每月再平衡后的净值序列算最大回撤', () => {
    // 60/40：10 月 +20% 后再 -25% → 组合 +12% 后 -15%
    const blended = blendedMaxDrawdownPct(series, flat, '2026-09-30', '2026-11-30', 0.6);

    expect(blended).toBeLessThan(0);
    expect(blended).toBeGreaterThan(-25);
    expect(blendedMaxDrawdownPct(series, [], '2026-09-30', '2026-11-30', 0.6)).toBeNull();
  });
});

describe('净值序列的起始日期', () => {
  it('只有一天净值时也报得出起始日期，收益率仍然是暂无', () => {
    const result = buildTwr([{ date: '2026-10-16', nav: 186325.01, captured_at: '2026-10-16T17:15:08.631Z' }], []);
    expect(result.start).toBe('2026-10-16');
    expect(result.end).toBe('2026-10-16');
    expect(result.returnPct).toBeNull();
    expect(result.periods).toBe(0);
  });

  it('一天净值都没有时才是 null', () => {
    expect(buildTwr([], []).start).toBeNull();
  });
});

describe('缺失和作废的净值点', () => {
  it('缺失那天跳过，不当成净值为 0，也不打断前后的链接', () => {
    const result = buildTwr([
      { date: '2026-10-16', nav: 100_000, captured_at: 'x' },
      { date: '2026-10-19', nav: null as unknown as number, missing: true, captured_at: null },
      { date: '2026-10-20', nav: 110_000, captured_at: 'y' },
    ], []);

    expect(result.start).toBe('2026-10-16');
    expect(result.end).toBe('2026-10-20');
    expect(result.returnPct).toBeCloseTo(10, 6);
    expect(result.periods).toBe(1);
  });

  it('标了作废的净值点不参与计算', () => {
    const result = buildTwr([
      { date: '2026-10-16', nav: 100_000, captured_at: 'x' },
      { date: '2026-10-17', nav: 100_000, captured_at: 'y', voided: true },
    ], []);

    expect(result.start).toBe('2026-10-16');
    expect(result.end).toBe('2026-10-16');
    expect(result.returnPct).toBeNull();
  });
});
