import { describe, expect, it } from 'vitest';
import { capSignalsFrom, positionBadge, positionCap, positionGuard, type CapSignals } from './positionGuard';
import type { PanicDrop } from './panicDrop';
import type { PortfolioMetrics, QuantAnalysisSnapshot } from './types';

// 只放仓位标注用得到的字段
function metrics(): PortfolioMetrics {
  const holding = (symbol: string, marketValue: number, extra: Record<string, unknown> = {}) => ({
    holding: { symbol, name: symbol, ...extra }, marketValue,
  });
  return {
    totalValue: 180_000,
    liquidityValue: 82_000,
    holdingsMetrics: [
      holding('TQQQ', 15_523.75),
      holding('TQQQ 270115C70', 717.93, { assetType: 'option', option: { underlying: 'TQQQ' } }),
      holding('UDOW', 1_000),
      holding('SGOV', 80_000, { cashEquivalent: true }),
    ],
  } as unknown as PortfolioMetrics;
}

// 现在的情况：11-05 恐慌窗口开着，CNN 19.85，VIX 28.18
const OPEN: CapSignals = { panicOpen: true, cnn: 19.85, vix: 28.18 };

describe('仓位上限', () => {
  it('没有恐慌性下跌：不管 CNN、VIX 多少，上限都是 30%', () => {
    expect(positionCap({ panicOpen: false, cnn: 5, vix: 60 })).toBe(30);
    expect(positionCap({ panicOpen: false, cnn: null, vix: null })).toBe(30);
  });

  it('有恐慌但 CNN 超过 20：还是 30%（CNN 是超过 30% 的基准要求）', () => {
    expect(positionCap({ panicOpen: true, cnn: 20.1, vix: 40 })).toBe(30);
  });

  it('有恐慌、CNN 20 以内、VIX 没到 25：40%，到不了 50%', () => {
    expect(positionCap({ panicOpen: true, cnn: 20, vix: 24.99 })).toBe(40);
  });

  it('有恐慌、CNN 20 以内、VIX 25 以上：50%，最大就是 50%', () => {
    expect(positionCap({ panicOpen: true, cnn: 20, vix: 25 })).toBe(50);
    expect(positionCap({ panicOpen: true, cnn: 3, vix: 80 })).toBe(50);
  });

  it('需要的数据拿不到就是暂无，不编数', () => {
    expect(positionCap({ panicOpen: null, cnn: 10, vix: 30 })).toBeNull();
    expect(positionCap({ panicOpen: true, cnn: null, vix: 30 })).toBeNull();
    expect(positionCap({ panicOpen: true, cnn: 10, vix: null })).toBeNull();
  });
});

describe('仓位上限用到的三个信号', () => {
  const snapshot = (context: Record<string, unknown>) => ({ context }) as unknown as QuantAnalysisSnapshot;
  const panic = (windowOpen: boolean | null) => ({ windowOpen }) as PanicDrop;

  it('CNN、VIX 从量化快照取，恐慌窗口从接口取', () => {
    expect(capSignalsFrom(
      snapshot({ cnn_fear_greed: { available: true, score: 19.85 }, vix: { available: true, value: 28.18 } }),
      panic(true),
    )).toEqual(OPEN);
  });

  it('拿不到的是 null', () => {
    expect(capSignalsFrom(null, null)).toEqual({ panicOpen: null, cnn: null, vix: null });
    expect(capSignalsFrom(
      snapshot({ cnn_fear_greed: { available: false, score: 19 }, vix: { available: false, value: 28 } }),
      panic(null),
    )).toEqual({ panicOpen: null, cnn: null, vix: null });
  });
});

describe('日志页的仓位标注', () => {
  it('仓位按 1 倍市值算，现金和现金类 ETF 算空仓；超出多少写清楚', () => {
    const guard = positionGuard(metrics(), -6, OPEN)!;
    // (180000 − 82000) ÷ 180000
    expect(guard.positionPct).toBeCloseTo(54.44, 2);
    expect(guard.capPct).toBe(50);
    expect(guard.overPct).toBeCloseTo(4.44, 2);
    expect(guard.overValue).toBeCloseTo(8_000, 0);
    expect(guard.signals).toEqual(OPEN);
  });

  it('上限不再看 SPY 跌多少：SPY -25% 没有恐慌窗口也是 30%', () => {
    expect(positionGuard(metrics(), -25, { panicOpen: false, cnn: 10, vix: 30 })!.capPct).toBe(30);
  });

  it('没到 SPY -5% 时持有 TQQQ（正股或期权）要提示；道指 3 倍 UDOW 不提示', () => {
    const guard = positionGuard(metrics(), -4.3, OPEN)!;
    expect(guard).toMatchObject({ tqqqBlocked: true, tqqqShares: 15_523.75, tqqqOptions: 717.93 });
    expect(positionGuard(metrics(), -5, OPEN)!.tqqqBlocked).toBe(false);
  });

  it('没超就不算超出', () => {
    const low = { ...metrics(), liquidityValue: 150_000 } as PortfolioMetrics;
    expect(positionGuard(low, -6, OPEN)).toMatchObject({ capPct: 50, overPct: null, overValue: null });
  });

  it('期权额度：总共 5%、其中 TQQQ 期权 3%，没超就给还剩多少美金', () => {
    const guard = positionGuard(metrics(), -4.3, OPEN)!;
    // 总资产 180000：期权上限 9000，已用 717.93；TQQQ 期权上限 5400
    expect(guard.options.total).toMatchObject({ cap: 0.05, overLimit: false });
    expect(guard.options.total.remainingValue).toBeCloseTo(8_282.07, 2);
    expect(guard.options.tqqq).toMatchObject({ cap: 0.03, overLimit: false });
    expect(guard.options.tqqq.remainingValue).toBeCloseTo(4_682.07, 2);
  });

  it('期权超了就给超出多少，还剩是 0', () => {
    const base = metrics();
    const over = { ...base, holdingsMetrics: [...base.holdingsMetrics, { holding: { symbol: 'NVDA C', name: 'NVDA C', assetType: 'option', option: { underlying: 'NVDA' } }, marketValue: 10_000 }] } as unknown as PortfolioMetrics;
    const guard = positionGuard(over, -4.3, OPEN)!;
    expect(guard.options.total).toMatchObject({ overLimit: true, remainingValue: 0 });
    expect(guard.options.total.overByValue).toBeCloseTo(1_717.93, 2);
  });

  it('没有持仓时不编数；信号拿不到时上限暂无；SPY 拿不到不提示 TQQQ', () => {
    expect(positionGuard(null, -4.3, OPEN)).toBeNull();
    expect(positionGuard({ ...metrics(), totalValue: 0 }, -4.3, OPEN)).toBeNull();
    expect(positionGuard(metrics(), null, { panicOpen: null, cnn: null, vix: null })).toMatchObject({ capPct: null, overPct: null, tqqqBlocked: false });
  });
});

describe('卡片上的徽章', () => {
  it('超了：当前仓位、上限、超了', () => {
    expect(positionBadge(positionGuard(metrics(), -6, OPEN))).toEqual({ text: '仓位 54.4% · 上限 50% · 超了', over: true });
  });

  it('没超', () => {
    const low = { ...metrics(), liquidityValue: 150_000 } as PortfolioMetrics;
    expect(positionBadge(positionGuard(low, -6, OPEN))).toEqual({ text: '仓位 16.7% · 上限 50% · 没超', over: false });
  });

  it('上限拿不到写暂无，不判超没超', () => {
    expect(positionBadge(positionGuard(metrics(), -6, { panicOpen: null, cnn: null, vix: null }))).toEqual({ text: '仓位 54.4% · 上限暂无', over: null });
    expect(positionBadge(null)).toBeNull();
  });
});
