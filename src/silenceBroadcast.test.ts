import { describe, expect, it } from 'vitest';
import type { QuantFinalVerdict } from './types';
import { dedupeVerdictSentence, layerRequirements, nearestVerdict } from './silenceBroadcast';

describe('dedupeVerdictSentence', () => {
  it('drops a 另有 clause that repeats an earlier reason verbatim', () => {
    expect(dedupeVerdictSentence('不买：六关未通过：低位、形态；另有六关未通过：低位、形态'))
      .toBe('不买：六关未通过：低位、形态');
  });

  it('keeps a 另有 clause that carries a different reason', () => {
    const sentence = '不买：基准 SOXX还差 10.99pp（触发价 $393.01）；另有六关未通过：形态';
    expect(dedupeVerdictSentence(sentence)).toBe(sentence);
  });

  it('returns non-duplicated sentences untouched', () => {
    expect(dedupeVerdictSentence('不买：1x 入场门尚未通过。')).toBe('不买：1x 入场门尚未通过。');
    expect(dedupeVerdictSentence('')).toBe('');
  });
});

function verdict(symbol: string, layers: QuantFinalVerdict['layers']): QuantFinalVerdict {
  return { symbol, verdict: 'NO_BUY', layers };
}

describe('nearestVerdict', () => {
  it('picks the symbol with the fewest failing layers', () => {
    const nearest = nearestVerdict([
      verdict('SOXL', [
        { layer: 'gates_six', state: 'failed' },
        { layer: 'entry_gate_1x', state: 'failed' },
        { layer: 'sleeve_borrow', state: 'failed' },
        { layer: 'buy_plan_conditions', state: 'failed' },
        { layer: 'panic_window', state: 'failed' },
      ]),
      verdict('AAPL', [
        { layer: 'gates_six', state: 'failed', reason: '六关未通过：低位、形态' },
        { layer: 'entry_gate_1x', state: 'not_applicable' },
        { layer: 'sleeve_borrow', state: 'passed' },
        { layer: 'buy_plan_conditions', state: 'not_applicable' },
        { layer: 'panic_window', state: 'not_applicable' },
      ]),
    ]);

    expect(nearest).toEqual({
      symbol: 'AAPL',
      passedCount: 4,
      totalCount: 5,
      blockingLabels: ['价格与估值'],
    });
  });

  it('breaks ties with the smallest remaining gap', () => {
    const nearest = nearestVerdict([
      verdict('TECL', [
        { layer: 'gates_six', state: 'passed' },
        { layer: 'entry_gate_1x', state: 'failed', gap_pp: 9 },
      ]),
      verdict('TQQQ', [
        { layer: 'gates_six', state: 'passed' },
        { layer: 'entry_gate_1x', state: 'failed', gap_pp: 2 },
      ]),
    ]);

    expect(nearest?.symbol).toBe('TQQQ');
  });

  it('ignores verdicts that are not NO_BUY and payloads without layers', () => {
    expect(nearestVerdict([{ symbol: 'FAS', verdict: 'UNDECIDABLE', layers: [{ layer: 'gates_six', state: 'failed' }] }])).toBeNull();
    expect(nearestVerdict([verdict('SPY', [])])).toBeNull();
    expect(nearestVerdict([])).toBeNull();
  });
});

describe('layerRequirements', () => {
  it('turns a failing layer gap into a price the user can wait for', () => {
    expect(layerRequirements(verdict('SOXL', [
      { layer: 'entry_gate_1x', state: 'failed', benchmark: 'SOXX', gap_pp: 10.99128, trigger_price: 393.006 },
    ]))).toEqual(['需要：SOXX 跌到 $393.01（还差 10.99pp）']);
  });

  it('omits layers that carry no trigger price', () => {
    expect(layerRequirements(verdict('AAPL', [
      { layer: 'gates_six', state: 'failed', reason: '六关未通过：低位、形态' },
      { layer: 'sleeve_borrow', state: 'passed', trigger_price: 1 },
    ]))).toEqual([]);
  });

  it('falls back to the symbol when the layer names no benchmark', () => {
    expect(layerRequirements(verdict('FNGU', [
      { layer: 'entry_gate_1x', state: 'failed', gap_pp: 0, trigger_price: 71.56579 },
    ]))).toEqual(['需要：FNGU 跌到 $71.57（还差 0.00pp）']);
  });
});
