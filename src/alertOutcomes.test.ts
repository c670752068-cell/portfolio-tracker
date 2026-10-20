import { describe, expect, it } from 'vitest';
import { horizonText, outcomeSummaryRows, parseAlertOutcomes, winRateText } from './alertOutcomes';

describe('提醒效果的读取与显示', () => {
  it('接口返回解析成空结构也不炸', () => {
    expect(parseAlertOutcomes(null)).toEqual({ updated_at: null, outcomes: {}, summary: [] });
    expect(parseAlertOutcomes({ outcomes: { updated_at: '2026-10-20T21:00:00.000Z', outcomes: {}, summary: [] } }))
      .toEqual({ updated_at: '2026-10-20T21:00:00.000Z', outcomes: {}, summary: [] });
  });

  it('还没到时间的显示「待定」，算出来的带正负号', () => {
    expect(horizonText(null)).toBe('待定');
    expect(horizonText(4.8077)).toBe('+4.81%');
    expect(horizonText(-1.5)).toBe('-1.50%');
  });

  it('胜率和样本不足的标注', () => {
    expect(winRateText(null)).toBe('暂无');
    expect(winRateText(0.625)).toBe('62.5%');
  });

  it('汇总行按次数从多到少排，样本太少的标出来', () => {
    const rows = outcomeSummaryRows([
      { kind: 'z_enter', label: 'Z 进入 ±1.5', samples: 3, pending: 1, backfilled: 0, avg: { d5: 1, d20: 2 }, excess: { d5: 0.5, d20: 1 }, winRate: 0.5, reliable: false, note: '样本太少，结论不可靠' },
      { kind: 'big_move', label: '个股大涨大跌', samples: 12, pending: 0, backfilled: 2, avg: { d5: -1, d20: -2 }, excess: { d5: -1.5, d20: -3 }, winRate: 0.25, reliable: true, note: '' },
    ]);

    expect(rows.map((row) => row.kind)).toEqual(['big_move', 'z_enter']);
    expect(rows[0].backfilledNote).toBe('含 2 条回填');
    expect(rows[1].note).toContain('样本太少');
    expect(rows[1].backfilledNote).toBe('');
  });
});
