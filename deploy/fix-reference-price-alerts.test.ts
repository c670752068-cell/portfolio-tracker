import { describe, expect, it } from 'vitest';
import {
  NEW_THRESHOLD_VOID_REASON, REFERENCE_FIX_REASON, Z_WORDING_FIX_REASON, applyReferencePriceFixes,
  planReferencePriceFixes, referenceClose,
} from './fix-reference-price-alerts.mjs';

const series = {
  SOXL: [
    { date: '2026-10-16', close: 93.67 },
    { date: '2026-10-19', close: 98.65 },
    { date: '2026-10-20', close: 97.55 },
  ],
  TQQQ: [
    { date: '2026-10-16', close: 68.2 },
    { date: '2026-10-19', close: 73.8 },
  ],
  AMZN: [
    { date: '2026-10-19', close: 262.45 },
    { date: '2026-10-20', close: 262.63 },
  ],
};
const seriesFor = (symbol: string) => series[symbol as keyof typeof series] ?? [];

function alert(partial: Record<string, unknown>) {
  return {
    id: 'a1', dedupe_key: 'big-move:SOXL:down:2026-10-19', category: 'other', symbol: 'SOXL',
    icon: '⚠️', value: -12.2, threshold: 5, session: 'overnight',
    occurred_at: '2026-10-19T04:00:00.000Z',
    text: '[夜盘] SOXL -12.2% · 94.31 · 持仓标的大跌',
    ...partial,
  };
}

describe('参考价：最近一个已完成常规交易日的收盘价', () => {
  it('当天收盘之后（盘后）用当天的收盘价', () => {
    // 美东 2026-10-20 17:52
    expect(referenceClose(series.SOXL, '2026-10-20T21:52:00.000Z')).toBe(97.55);
  });

  it('当天收盘之前（盘前、夜盘）用上一个交易日的收盘价', () => {
    // 美东 2026-10-20 04:01
    expect(referenceClose(series.AMZN, '2026-10-20T08:01:00.000Z')).toBe(262.45);
    // 美东 2026-10-19 00:00（周日夜盘）→ 周五
    expect(referenceClose(series.SOXL, '2026-10-19T04:00:00.000Z')).toBe(93.67);
  });

  it('没有行情就算不出，返回空', () => {
    expect(referenceClose([], '2026-10-20T08:01:00.000Z')).toBeNull();
    expect(referenceClose(series.SOXL, '2020-01-01T08:01:00.000Z')).toBeNull();
  });
});

describe('按真实收盘价重算非常规时段的大涨大跌', () => {
  it('实际没到阈值的标作废，写明原因', () => {
    // 夜盘 TQQQ 67.85：对周五 68.2 实际 -0.5%，够不上 ±5%
    const plan = planReferencePriceFixes({
      alerts: [alert({
        id: 'tqqq', dedupe_key: 'big-move:TQQQ:down:2026-10-19', symbol: 'TQQQ', value: -8.1,
        text: '[夜盘] TQQQ -8.1% · 67.85 · 持仓标的大跌',
      })],
    }, { seriesFor });

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ id: 'tqqq', action: 'void', reason: REFERENCE_FIX_REASON });
    expect(plan[0].actualPct).toBeCloseTo(-0.51, 2);
  });

  it('实际仍超过阈值的改正数字并标「已更正」', () => {
    // 盘后 SOXL 103.59：对 10-20 收盘 97.55 实际 +6.19%
    const plan = planReferencePriceFixes({
      alerts: [alert({
        id: 'soxl-post', dedupe_key: 'big-move:SOXL:up:2026-10-20', value: 5.0, session: 'post',
        occurred_at: '2026-10-20T21:52:00.000Z',
        text: '[盘后] SOXL +5.0% · 103.59 · 持仓标的大涨',
      })],
    }, { seriesFor });

    expect(plan[0]).toMatchObject({ id: 'soxl-post', action: 'correct' });
    expect(plan[0].actualPct).toBeCloseTo(6.19, 2);
    expect(plan[0].text).toBe('[盘后] SOXL +6.2% · 103.59 · 持仓标的大涨');
  });

  it('方向反了也照实改：原来记大跌，实际是大涨', () => {
    // 盘前 SOXL 100.60：对周五 93.67 实际 +7.4%
    const plan = planReferencePriceFixes({
      alerts: [alert({
        id: 'soxl-pre', dedupe_key: 'big-move:SOXL:down:2026-10-19', session: 'pre', value: -6.3,
        occurred_at: '2026-10-19T08:02:00.000Z',
        text: '[盘前] SOXL -6.3% · 100.60 · 持仓标的大跌',
      })],
    }, { seriesFor });

    expect(plan[0].action).toBe('correct');
    expect(plan[0].actualPct).toBeCloseTo(7.4, 1);
    expect(plan[0].text).toBe('[盘前] SOXL +7.4% · 100.60 · 持仓标的大涨');
  });

  it('盘中的、已经处理过的、以及算不出参考价的都不碰', () => {
    const plan = planReferencePriceFixes({
      alerts: [
        alert({ id: 'regular', session: 'regular' }),
        alert({ id: 'done', voided: true }),
        alert({ id: 'fixed', corrected: true }),
        alert({ id: 'nodata', symbol: 'XXXX', text: '[夜盘] XXXX -9.0% · 10.00 · 持仓标的大跌' }),
        alert({ id: 'notext', text: '[夜盘] SOXL 没有价格的一行' }),
      ],
    }, { seriesFor });

    expect(plan).toEqual([]);
  });

  it('盘前盘后的 Z 条目一律作废：那是隔夜缓存重放的', () => {
    const plan = planReferencePriceFixes({
      alerts: [alert({
        id: 'z1', dedupe_key: 'z-cross:AMZN:0.5:up:2026-10-20', category: 'zscore', symbol: 'AMZN',
        session: 'pre', occurred_at: '2026-10-20T08:01:00.000Z', value: 0.94,
        text: '[盘前] AMZN $262.59 · Z 0.35 → 0.94 · 涨得更多，偏强',
      })],
    }, { seriesFor });

    expect(plan[0]).toMatchObject({ id: 'z1', action: 'void' });
    expect(plan[0].reason).toContain('隔夜缓存');
  });
});

describe('把结论写回日志', () => {
  it('作废只加标记，更正保留原文', () => {
    const store = {
      version: 1, updated_at: null, states: {},
      alerts: [
        alert({ id: 'tqqq', dedupe_key: 'big-move:TQQQ:down:2026-10-19', symbol: 'TQQQ', value: -8.1, text: '[夜盘] TQQQ -8.1% · 67.85 · 持仓标的大跌' }),
        alert({ id: 'soxl-post', dedupe_key: 'big-move:SOXL:up:2026-10-20', session: 'post', value: 5.0, occurred_at: '2026-10-20T21:52:00.000Z', text: '[盘后] SOXL +5.0% · 103.59 · 持仓标的大涨' }),
      ],
    };

    const next = applyReferencePriceFixes(store, { seriesFor, now: new Date('2026-10-21T03:00:00.000Z') });
    const voided = next.alerts.find((item) => item.id === 'tqqq')!;
    const corrected = next.alerts.find((item) => item.id === 'soxl-post')!;

    expect(voided).toMatchObject({ voided: true, voided_reason: REFERENCE_FIX_REASON });
    expect(voided.text).toBe('[夜盘] TQQQ -8.1% · 67.85 · 持仓标的大跌');
    expect(corrected).toMatchObject({ corrected: true, value: expect.any(Number) });
    expect(corrected.text).toContain('+6.2%');
    expect(corrected.corrected_from).toBe('[盘后] SOXL +5.0% · 103.59 · 持仓标的大涨');
    expect(next.alerts).toHaveLength(2);

    // 下一轮按新阈值（SOXL 是 3 倍 ETF，±12%）把这条标作废，再下一轮就不动了
    const second = applyReferencePriceFixes(next, { seriesFor, now: new Date('2026-10-21T10:00:00.000Z') });
    expect(second.alerts.find((item) => item.id === 'soxl-post')).toMatchObject({
      voided: true, voided_reason: '按新阈值不再提醒', corrected: true,
    });
    expect(applyReferencePriceFixes(second, { seriesFor })).toBe(second);
  });
});

describe('旧条目的 Z 措辞按 1.2 / 1.5 分档改正', () => {
  const zRow = (value: number, text: string) => ({
    id: `z-${value}`, dedupe_key: `z-cross:DIA:1:up:2026-10-20`, category: 'zscore', symbol: 'DIA',
    session: 'regular', occurred_at: '2026-10-20T14:56:00.000Z', value, text,
  });

  it('|Z| 不到 1.2 的改成「偏强 / 偏弱」，标已更正并保留原文', () => {
    const plan = planReferencePriceFixes({
      alerts: [zRow(1.01, '[盘中] DIA $525.91 · Z 0.95 → 1.01 · 涨得更多，接近卖出区 +1.5')],
    }, { seriesFor: () => [] });

    expect(plan[0]).toMatchObject({ action: 'correct', reason: Z_WORDING_FIX_REASON });
    expect(plan[0].text).toBe('[盘中] DIA $525.91 · Z 0.95 → 1.01 · 涨得更多，偏强');
  });

  it('向下穿的改成「偏弱」', () => {
    const plan = planReferencePriceFixes({
      alerts: [{
        ...zRow(-1.02, '[盘中] FNGU $32.39 · Z -0.95 → -1.02 · 跌得更深，接近买入区 -1.5'),
        dedupe_key: 'z-cross:FNGU:-1:down:2026-10-20', symbol: 'FNGU',
      }],
    }, { seriesFor: () => [] });

    expect(plan[0].text).toBe('[盘中] FNGU $32.39 · Z -0.95 → -1.02 · 跌得更深，偏弱');
  });

  it('|Z| 已经到 1.2 的不动，已经写「偏强」的也不动', () => {
    const plan = planReferencePriceFixes({
      alerts: [
        zRow(1.28, '[盘中] NVDA $217 · Z 0.95 → 1.28 · 涨得更多，接近卖出区 +1.5'),
        zRow(0.52, '[盘中] UDOW $67.41 · Z 0.38 → 0.52 · 涨得更多，偏强'),
      ],
    }, { seriesFor: () => [] });

    expect(plan).toEqual([]);
  });
});

describe('按新阈值不再成立的旧提醒', () => {
  const corrected = {
    id: 'soxl', dedupe_key: 'big-move:SOXL:up:2026-10-20', category: 'other', symbol: 'SOXL',
    session: 'post', occurred_at: '2026-10-20T21:52:00.000Z', value: 6.19, threshold: 5,
    text: '[盘后] SOXL +6.2% · 103.59 · 持仓标的大涨',
    corrected: true, corrected_reason: REFERENCE_FIX_REASON,
    corrected_from: '[盘后] SOXL +5.0% · 103.59 · 持仓标的大涨',
  };

  it('3 倍 ETF 涨 6.2% 按新阈值（±12%）不再是提醒，标作废并写明原因', () => {
    const plan = planReferencePriceFixes({ alerts: [corrected] }, { seriesFor: () => [] });

    expect(plan[0]).toMatchObject({
      id: 'soxl', action: 'void', reason: NEW_THRESHOLD_VOID_REASON,
    });
  });

  it('仍然超过新阈值的不动', () => {
    const plan = planReferencePriceFixes({
      alerts: [{ ...corrected, value: 13.5, text: '[盘后] SOXL +13.5% · 110.00 · 持仓标的大涨' }],
    }, { seriesFor: () => [] });

    expect(plan).toEqual([]);
  });

  it('普通个股仍按 ±5% 判断', () => {
    const plan = planReferencePriceFixes({
      alerts: [{
        ...corrected, id: 'amzn', symbol: 'AMZN', dedupe_key: 'big-move:AMZN:up:2026-10-20',
        value: 6.19, text: '[盘后] AMZN +6.2% · 263.30 · 观察标的大涨',
      }],
    }, { seriesFor: () => [] });

    expect(plan).toEqual([]);
  });

  it('写回时只加作废标记，原文和更正记录都留着', () => {
    const next = applyReferencePriceFixes(
      { version: 1, updated_at: null, states: {}, alerts: [corrected] },
      { seriesFor: () => [], now: new Date('2026-10-21T10:00:00.000Z') },
    );
    const row = next.alerts[0];

    expect(row).toMatchObject({ voided: true, voided_reason: NEW_THRESHOLD_VOID_REASON, corrected: true });
    expect(row.text).toBe('[盘后] SOXL +6.2% · 103.59 · 持仓标的大涨');
    expect(row.corrected_from).toBe('[盘后] SOXL +5.0% · 103.59 · 持仓标的大涨');
  });
});

