import { describe, expect, it } from 'vitest';
import { resolveDecisionLog, resolveTrade, RESOLVE_EXPIRY_DAYS } from './decision-log-resolve.mjs';

type Close = { date: string; close: number };
function ramp(start: string, closes: number[]): Close[] {
  const first = new Date(`${start}T12:00:00Z`);
  return closes.map((close, index) => {
    const day = new Date(first);
    day.setUTCDate(day.getUTCDate() + index);
    return { date: day.toISOString().slice(0, 10), close };
  });
}

function trade(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trade-1', trade_time: '2026-01-05T15:00:00Z', symbol: 'TQQQ', side: 'SELL', qty: 100,
    price: 100, amount: 10_000, status: 'in_progress',
    prediction: { type: 'rebuy_after_dip', dip_pct: 10, reference_symbol: 'QQQ' },
    resolved_at: null, resolved_price: null, result_pct: null, qqq_result_pct: null, vs_hold_pct: null,
    ...overrides,
  };
}

describe('预判结果自动判定', () => {
  it('卖出后等回调：QQQ 从前高回撤 10% 那天接回，接回价更低算命中', () => {
    // QQQ 前高 100，回撤到 90 的那天是第 5 天；TQQQ 当天收盘 70（卖出价 100）
    const reference = ramp('2026-01-05', [100, 98, 96, 94, 90, 92]);
    const own = ramp('2026-01-05', [100, 95, 88, 80, 70, 75]);

    const patch = resolveTrade(trade(), { ownSeries: own, referenceSeries: reference, today: '2026-01-20' });

    expect(patch).toMatchObject({ status: 'hit', resolved_at: '2026-01-09', resolved_price: 70 });
    expect(patch!.vs_hold_pct).toBeCloseTo(30, 6);
  });

  it('接回价比卖出价还高算未命中', () => {
    const reference = ramp('2026-01-05', [100, 98, 96, 94, 90]);
    const own = ramp('2026-01-05', [100, 108, 115, 120, 130]);

    const patch = resolveTrade(trade(), { ownSeries: own, referenceSeries: reference, today: '2026-01-20' });

    expect(patch).toMatchObject({ status: 'miss', resolved_price: 130 });
    expect(patch!.vs_hold_pct).toBeCloseTo(-30, 6);
  });

  it('前高取「卖出前 52 周最高」和「卖出后新高」里更高的那个', () => {
    // 卖出后创了新高 120，回撤 10% 的线是 108，不是按卖出当天的 100 算
    const reference = [
      ...ramp('2025-06-01', [95]),
      ...ramp('2026-01-05', [100, 120, 115, 107, 105]),
    ];
    const own = ramp('2026-01-05', [100, 118, 112, 96, 94]);

    const patch = resolveTrade(trade(), { ownSeries: own, referenceSeries: reference, today: '2026-02-01' });

    expect(patch).toMatchObject({ status: 'hit', resolved_at: '2026-01-08', resolved_price: 96 });
  });

  it('超过 365 天没触发就过期，按当前价算比不操作差多少', () => {
    const reference = ramp('2026-01-05', Array.from({ length: 400 }, () => 100));
    const own = ramp('2026-01-05', Array.from({ length: 400 }, (_, index) => (index === 399 ? 150 : 110)));

    const patch = resolveTrade(trade(), { ownSeries: own, referenceSeries: reference, today: '2027-02-10' });

    expect(RESOLVE_EXPIRY_DAYS).toBe(365);
    expect(patch).toMatchObject({ status: 'expired', resolved_price: 150 });
    expect(patch!.vs_hold_pct).toBeCloseTo(-50, 6);
  });

  it('目标价：期限内摸到算命中，到期没摸到算未命中', () => {
    const own = ramp('2026-01-05', [100, 105, 112, 108]);
    const prediction = { type: 'target_price', target_price: 110, horizon_months: 1 };

    const hit = resolveTrade(trade({ side: 'BUY', prediction }), { ownSeries: own, referenceSeries: [], today: '2026-01-20' });
    expect(hit).toMatchObject({ status: 'hit', resolved_at: '2026-01-07', resolved_price: 112 });

    const flat = ramp('2026-01-05', Array.from({ length: 40 }, () => 100));
    const miss = resolveTrade(trade({ side: 'BUY', prediction }), { ownSeries: flat, referenceSeries: [], today: '2026-03-01' });
    expect(miss).toMatchObject({ status: 'miss' });
  });

  it('跑赢 QQQ：期满才判，涨得比 QQQ 多算命中', () => {
    const own = ramp('2026-01-05', Array.from({ length: 120 }, (_, index) => 100 + index * 0.2));
    const reference = ramp('2026-01-05', Array.from({ length: 120 }, (_, index) => 100 + index * 0.05));
    const prediction = { type: 'beat_qqq', horizon_months: 3, reference_symbol: 'QQQ' };

    const early = resolveTrade(trade({ side: 'BUY', prediction }), { ownSeries: own, referenceSeries: reference, today: '2026-02-01' });
    expect(early).toBeNull();

    const done = resolveTrade(trade({ side: 'BUY', prediction }), { ownSeries: own, referenceSeries: reference, today: '2026-05-01' });
    expect(done!.status).toBe('hit');
    // 3 个月后的那天（2026-04-05）是第 90 根：自己 118、QQQ 104.5
    expect(done!.result_pct).toBeCloseTo(18, 1);
    expect(done!.qqq_result_pct).toBeCloseTo(4.5, 1);
  });

  it('止盈规则只记走势，不判命中', () => {
    const own = ramp('2026-01-05', Array.from({ length: 70 }, (_, index) => 100 + index));
    const patch = resolveTrade(
      trade({ prediction: { type: 'take_profit_rule', trailing_pct: 15, fixed_gain_pct: null } }),
      { ownSeries: own, referenceSeries: [], today: '2026-04-01' },
    );

    expect(patch!.status).toBe('in_progress');
    expect(patch!.follow_up).toMatchObject({ after_20_sessions_pct: expect.any(Number), after_60_sessions_pct: expect.any(Number) });
  });

  it('没有预判、价格或行情时什么都不改', () => {
    expect(resolveTrade(trade({ prediction: null }), { ownSeries: [], referenceSeries: [], today: '2026-02-01' })).toBeNull();
    expect(resolveTrade(trade({ price: null }), { ownSeries: [], referenceSeries: [], today: '2026-02-01' })).toBeNull();
    expect(resolveTrade(trade(), { ownSeries: [], referenceSeries: [], today: '2026-02-01' })).toBeNull();
    expect(resolveTrade(trade({ status: 'hit' }), { ownSeries: [], referenceSeries: [], today: '2026-02-01' })).toBeNull();
  });

  it('整份日志一起判，并给出需要哪些行情', () => {
    const store = {
      version: 1, revision: 3, updated_at: null, cash_flows: [], nav_series: [],
      trades: [
        trade(),
        trade({ id: 'trade-2', symbol: 'NVDA', side: 'BUY', prediction: { type: 'target_price', target_price: 110, horizon_months: 1 } }),
        trade({ id: 'trade-3', status: 'pending_note', prediction: null }),
      ],
    };
    const series: Record<string, Close[]> = {
      TQQQ: ramp('2026-01-05', [100, 95, 88, 80, 70]),
      QQQ: ramp('2026-01-05', [100, 98, 96, 94, 90]),
      NVDA: ramp('2026-01-05', [100, 105, 112]),
    };

    const next = resolveDecisionLog(store, { seriesFor: (symbol: string) => series[symbol] ?? [], today: '2026-02-01', now: new Date('2026-02-01T21:00:00Z') });

    expect(next.revision).toBe(4);
    expect(next.trades.map((item: { id: string; status: string }) => [item.id, item.status])).toEqual([
      ['trade-1', 'hit'], ['trade-2', 'hit'], ['trade-3', 'pending_note'],
    ]);
    expect(resolveDecisionLog(store, { seriesFor: () => [], today: '2026-02-01' })).toBe(store);
  });
});
