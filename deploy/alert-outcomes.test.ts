import { describe, expect, it } from 'vitest';
import {
  MIN_RELIABLE_SAMPLES, OUTCOME_HORIZONS, OUTCOME_KIND_LABELS, alertOutcomeKind, computeAlertOutcomes,
  outcomeSymbol, summarizeOutcomes,
} from './alert-outcomes.mjs';

function closes(start: string, values: number[]) {
  const first = new Date(`${start}T00:00:00Z`);
  return values.map((close, index) => {
    const day = new Date(first);
    day.setUTCDate(day.getUTCDate() + index);
    return { date: day.toISOString().slice(0, 10), close };
  });
}

describe('提醒归到哪一类统计', () => {
  it('九类统计的中文名齐全', () => {
    expect(Object.values(OUTCOME_KIND_LABELS)).toEqual([
      'QQQ 回撤档位', 'VIX 飙升', 'CNN 恐慌', 'Z 进入 ±1.5', 'Z 穿过 ±1.0',
      '个股大涨大跌', '卖出线', '多指标共振', '可买 / 低估值',
    ]);
  });

  it.each([
    ['qqq-drawdown-live:5:2026-10-15', 'qqq_drawdown'],
    ['qqq-drawdown:10:2026-10-15', 'qqq_drawdown'],
    ['vix-rise:25:2026-10-20', 'vix_spike'],
    ['vix-level:23:2026-10-20', 'vix_spike'],
    ['cnn-tier:20:2026-10-20', 'cnn_fear'],
    ['cnn-deeper:18:2026-10-20', 'cnn_fear'],
    ['z-cross:NVDA:1.5:up:2026-10-20', 'z_enter'],
    ['z-cross:MU:-2:down:2026-10-20', 'z_enter'],
    ['z-cross:TSLA:-1:down:2026-10-20', 'z_cross_1'],
    ['big-move:SOXL:down:2026-10-20', 'big_move'],
    ['sell-line-live:NVDA:210:2026-10-20', 'sell_line'],
    ['resonance:2026-10-20', 'resonance'],
    ['push:2026-10-20:premarket:valuation:AVGO:low', 'valuation_buy'],
    ['push:2026-10-20:premarket:buy:NKE:理由', 'valuation_buy'],
  ])('%s → %s', (key, kind) => {
    expect(alertOutcomeKind({ dedupe_key: key })).toBe(kind);
  });

  it('噪音和与行情无关的条目不统计', () => {
    expect(alertOutcomeKind({ dedupe_key: 'z-cross:UDOW:0.5:up:2026-10-20' })).toBeNull();
    expect(alertOutcomeKind({ dedupe_key: 'vix-relief:2026-10-20' })).toBeNull();
    expect(alertOutcomeKind({ dedupe_key: 'cnn-relief:32:2026-10-20' })).toBeNull();
    expect(alertOutcomeKind({ dedupe_key: 'holdings:FUTU|NVDA|BUY|5|x' })).toBeNull();
    expect(alertOutcomeKind({ dedupe_key: 'summary:2026-10-20:premarket:valuation' })).toBeNull();
    expect(alertOutcomeKind({ dedupe_key: 'state:realtime-feed:triggered:x' })).toBeNull();
  });

  it('CNN 和 VIX 这类不可交易的，看之后 QQQ 怎么走', () => {
    expect(outcomeSymbol({ symbol: 'CNN', dedupe_key: 'cnn-tier:20:x' })).toBe('QQQ');
    expect(outcomeSymbol({ symbol: 'VIX', dedupe_key: 'vix-rise:25:x' })).toBe('QQQ');
    expect(outcomeSymbol({ symbol: 'NVDA', dedupe_key: 'z-cross:NVDA:1.5:up:x' })).toBe('NVDA');
    expect(outcomeSymbol({ symbol: null, dedupe_key: 'resonance:x' })).toBe('QQQ');
  });
});

describe('按收盘价算第 1 / 5 / 20 个交易日的涨跌', () => {
  const series = closes('2026-10-01', Array.from({ length: 30 }, (_, index) => 100 + index));
  const qqq = closes('2026-10-01', Array.from({ length: 30 }, (_, index) => 200 + index * 0.5));
  const store = {
    alerts: [{
      id: 'alert-1', dedupe_key: 'z-cross:NVDA:-1.5:down:2026-10-05', symbol: 'NVDA',
      occurred_at: '2026-10-05T18:30:00.000Z', backfilled: false,
    }],
  };

  it('基准是提醒当天的收盘价，之后按交易日数', () => {
    const outcomes = computeAlertOutcomes(store, {
      seriesFor: (symbol: string) => (symbol === 'QQQ' ? qqq : series),
    });

    expect(OUTCOME_HORIZONS).toEqual([1, 5, 20]);
    expect(outcomes['alert-1']).toMatchObject({
      kind: 'z_enter', symbol: 'NVDA', base_date: '2026-10-05', base_close: 104, pending: false,
    });
    // 104 → 105 / 109 / 124
    expect(outcomes['alert-1'].changes.d1).toBeCloseTo(0.9615, 3);
    expect(outcomes['alert-1'].changes.d5).toBeCloseTo(4.8077, 3);
    expect(outcomes['alert-1'].changes.d20).toBeCloseTo(19.2308, 3);
    // 同期 QQQ：202 → 202.5 / 204.5 / 212
    expect(outcomes['alert-1'].benchmark.d5).toBeCloseTo(1.2376, 3);
    expect(outcomes['alert-1'].excess.d20).toBeCloseTo(19.2308 - 4.9505, 3);
  });

  it('还没到时间的那几档留空并标「待定」', () => {
    const outcomes = computeAlertOutcomes({
      alerts: [{
        id: 'alert-2', dedupe_key: 'z-cross:NVDA:-1.5:down:2026-10-28', symbol: 'NVDA',
        occurred_at: '2026-10-28T18:30:00.000Z', backfilled: false,
      }],
    }, { seriesFor: () => series });

    expect(outcomes['alert-2'].changes.d1).toBeCloseTo(1 / 127 * 100, 3);
    expect(outcomes['alert-2'].changes.d5).toBeNull();
    expect(outcomes['alert-2'].changes.d20).toBeNull();
    expect(outcomes['alert-2'].pending).toBe(true);
  });

  it('已作废的不算，没有行情的也不算', () => {
    const outcomes = computeAlertOutcomes({
      alerts: [
        { id: 'v1', dedupe_key: 'z-cross:NVDA:-1.5:down:x', symbol: 'NVDA', occurred_at: '2026-10-05T18:30:00.000Z', voided: true },
        { id: 'n1', dedupe_key: 'z-cross:XXXX:-1.5:down:x', symbol: 'XXXX', occurred_at: '2026-10-05T18:30:00.000Z' },
      ],
    }, { seriesFor: (symbol: string) => (symbol === 'NVDA' ? series : []) });

    expect(outcomes.v1).toBeUndefined();
    expect(outcomes.n1).toBeUndefined();
  });
});

describe('按类型汇总', () => {
  function outcome(kind: string, d5: number, d20: number, benchmark20: number, backfilled = false) {
    return {
      kind, symbol: 'NVDA', base_date: '2026-10-05', base_close: 100, backfilled, pending: false,
      changes: { d1: 0, d5, d20 },
      benchmark: { d1: 0, d5: 0, d20: benchmark20 },
      excess: { d1: 0, d5, d20: d20 - benchmark20 },
    };
  }

  it('样本少于 10 次标「样本太少」，回填的单独数', () => {
    const summary = summarizeOutcomes({
      a: outcome('z_enter', 2, 6, 3),
      b: outcome('z_enter', -1, -4, 1, true),
    });
    const group = summary.find((item) => item.kind === 'z_enter')!;

    expect(MIN_RELIABLE_SAMPLES).toBe(10);
    expect(group).toMatchObject({ samples: 2, backfilled: 1, reliable: false });
    expect(group.note).toContain('样本太少');
    expect(group.avg.d5).toBeCloseTo(0.5, 6);
    expect(group.avg.d20).toBeCloseTo(1, 6);
    expect(group.excess.d20).toBeCloseTo((6 - 3 + (-4 - 1)) / 2, 6);
    expect(group.winRate).toBeCloseTo(0.5, 6);
  });

  it('还没到时间的不计进平均，只记在待定里', () => {
    const summary = summarizeOutcomes({
      a: outcome('sell_line', 1, 2, 1),
      b: { ...outcome('sell_line', 0, 0, 0), pending: true, changes: { d1: null, d5: null, d20: null }, excess: { d1: null, d5: null, d20: null }, benchmark: { d1: null, d5: null, d20: null } },
    });
    const group = summary.find((item) => item.kind === 'sell_line')!;

    expect(group).toMatchObject({ samples: 2, pending: 1 });
    expect(group.avg.d20).toBeCloseTo(2, 6);
  });

  it('一类都没有就不出现在汇总里', () => {
    expect(summarizeOutcomes({}).length).toBe(0);
  });
});

describe('统计口径', () => {
  function valuationOutcome(symbol: string, date: string, zone = 'low') {
    return {
      kind: 'valuation_buy', symbol, base_date: date, base_close: 100, backfilled: false, pending: false,
      run_key: `valuation:${symbol}:${zone}`,
      changes: { d1: 0, d5: 1, d20: 2 },
      benchmark: { d1: 0, d5: 0.5, d20: 1 },
      excess: { d1: 0, d5: 0.5, d20: 1 },
    };
  }

  it('同一标的同一状态连续多天只算第一次', () => {
    const summary = summarizeOutcomes({
      a: valuationOutcome('AVGO', '2026-10-16'),
      b: valuationOutcome('AVGO', '2026-10-19'),
      c: valuationOutcome('AVGO', '2026-10-20'),
      d: valuationOutcome('MCD', '2026-10-20'),
    });
    const group = summary.find((item) => item.kind === 'valuation_buy')!;

    expect(group.samples).toBe(2);
  });

  it('隔了很久又进入同一状态，算新的一次', () => {
    const summary = summarizeOutcomes({
      a: valuationOutcome('AVGO', '2026-09-01'),
      b: valuationOutcome('AVGO', '2026-10-20'),
    });

    expect(summary.find((item) => item.kind === 'valuation_buy')!.samples).toBe(2);
  });

  it('换了档位算新的一次', () => {
    const summary = summarizeOutcomes({
      a: valuationOutcome('AVGO', '2026-10-19', 'low'),
      b: valuationOutcome('AVGO', '2026-10-20', 'extreme_low'),
    });

    expect(summary.find((item) => item.kind === 'valuation_buy')!.samples).toBe(2);
  });

  it('看的就是 QQQ 自己的那几类，超额留空并标出来', () => {
    const qqqOutcome = (kind: string) => ({
      kind, symbol: 'QQQ', base_date: '2026-10-16', base_close: 700, backfilled: false, pending: false,
      changes: { d1: 1, d5: 2, d20: 3 },
      benchmark: { d1: 1, d5: 2, d20: 3 },
      excess: { d1: 0, d5: 0, d20: 0 },
    });
    const summary = summarizeOutcomes({ a: qqqOutcome('cnn_fear'), b: qqqOutcome('qqq_drawdown') });

    for (const group of summary) {
      expect(group.selfBenchmark).toBe(true);
      expect(group.excess.d5).toBeNull();
      expect(group.excess.d20).toBeNull();
    }
  });

  it('个股那几类照常算超额', () => {
    const summary = summarizeOutcomes({
      a: {
        kind: 'big_move', symbol: 'NVDA', base_date: '2026-10-16', base_close: 100, backfilled: false,
        pending: false, changes: { d1: 1, d5: 2, d20: 6 }, benchmark: { d1: 0, d5: 1, d20: 3 },
        excess: { d1: 1, d5: 1, d20: 3 },
      },
    });

    expect(summary[0].selfBenchmark).toBe(false);
    expect(summary[0].excess.d20).toBeCloseTo(3, 6);
  });

  it('算出来的 outcome 带上 run_key，给统计去重用', () => {
    const series = closes('2026-10-01', Array.from({ length: 30 }, (_, index) => 100 + index));
    const outcomes = computeAlertOutcomes({
      alerts: [{
        id: 'v1', dedupe_key: 'push:2026-10-05:premarket:valuation:AVGO:low:2026-10-05',
        symbol: 'AVGO', occurred_at: '2026-10-05T12:30:00.000Z', backfilled: false,
      }],
    }, { seriesFor: () => series });

    expect(outcomes.v1.run_key).toBe('valuation:AVGO:low');
  });
});

