import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { QuantAnalysisSnapshot, QuantFinalVerdict } from '../types';
import { SymbolVerdictCard } from './SymbolVerdictCard';

function snapshotWith(verdict: QuantFinalVerdict): QuantAnalysisSnapshot {
  return { final_verdict: { symbols: { [verdict.symbol]: verdict } } } as unknown as QuantAnalysisSnapshot;
}

const tqqq: QuantFinalVerdict = {
  symbol: 'TQQQ',
  verdict: 'NO_BUY',
  single_sentence: '不买：已用满 10.0pp 借额（上限 75%），仍超硬顶 30,386，不建议新增科技；另有已用满 10.0pp 借额（上限 75%），仍超硬顶 30,386，不建议新增科技',
  layers: [
    { layer: 'gates_six', label: '价格与估值', state: 'passed', reason: '价格与估值 1/1 已通过' },
    { layer: 'entry_gate_1x', label: '1x 入场门', state: 'passed', reason: '以 QQQ 闭市价判定｜回撤 11.22% / 阈值 11.00%：✓' },
    { layer: 'sleeve_borrow', label: '板块额度', state: 'failed', reason: '已用满 10.0pp 借额（上限 75%），仍超硬顶 30,386，不建议新增科技' },
    { layer: 'buy_plan_conditions', label: '计划条件', state: 'failed', reason: '已用满 10.0pp 借额（上限 75%），仍超硬顶 30,386，不建议新增科技' },
    { layer: 'panic_window', label: '恐慌窗口', state: 'failed', reason: '等待 1× 深度位与恐慌位同时满足' },
  ],
};

describe('SymbolVerdictCard', () => {
  it('renders every server-owned layer row with its own state', () => {
    const html = renderToStaticMarkup(<SymbolVerdictCard snapshot={snapshotWith(tqqq)} symbol="TQQQ" />);

    expect(html).toContain('价格与估值');
    expect(html).toContain('1x 入场门');
    expect(html).toContain('板块额度');
    expect(html).toContain('计划条件');
    expect(html).toContain('恐慌窗口');
    expect(html).toContain('data-layer-state="passed">✓');
    expect(html).toContain('data-layer-state="failed">✗');
    expect(html).toContain('超硬顶 30,386');
  });

  it('names the blocked state without the misread-prone 条件完整 / 不买 wording', () => {
    const html = renderToStaticMarkup(<SymbolVerdictCard snapshot={snapshotWith(tqqq)} symbol="TQQQ" />);

    expect(html).toContain('暂不满足');
    expect(html).not.toContain('条件完整');
  });

  it('drops the backend 另有 clause that repeats the same reason', () => {
    const html = renderToStaticMarkup(<SymbolVerdictCard snapshot={snapshotWith(tqqq)} symbol="TQQQ" />);

    expect(html).toContain('data-verdict-field="sentence">不买：已用满 10.0pp 借额（上限 75%），仍超硬顶 30,386，不建议新增科技</p>');
    expect(html).not.toContain('；另有');
  });

  it('turns a blocking layer gap into the price to wait for', () => {
    const tecl: QuantFinalVerdict = {
      symbol: 'TECL',
      verdict: 'NO_BUY',
      single_sentence: '不买：基准 XLK 还差 0pp（触发价 $176.20）',
      layers: [
        { layer: 'entry_gate_1x', label: '1x 入场门', state: 'failed', reason: '均线触及 ✗', benchmark: 'XLK', gap_pp: 0.24, trigger_price: 176.2 },
      ],
    };

    const html = renderToStaticMarkup(<SymbolVerdictCard snapshot={snapshotWith(tecl)} symbol="TECL" />);

    expect(html).toContain('需要：XLK 跌到 $176.20');
  });

  it('marks a not-applicable layer without claiming it passed', () => {
    const tecl: QuantFinalVerdict = {
      symbol: 'TECL',
      verdict: 'NO_BUY',
      layers: [
        { layer: 'buy_plan_conditions', label: '计划条件', state: 'not_applicable', reason: '未配置该标的计划条件' },
      ],
    };

    const html = renderToStaticMarkup(<SymbolVerdictCard snapshot={snapshotWith(tecl)} symbol="TECL" />);

    expect(html).toContain('data-layer-state="not_applicable">○');
    expect(html).toContain('不适用');
  });

  it('will not tick a layer that only passed because its inputs are missing', () => {
    const missing: QuantFinalVerdict = {
      symbol: 'TQQQ',
      verdict: 'NO_BUY',
      layers: [
        { layer: 'gates_six', label: '估值/情绪', state: 'passed', reason: '指数估值或 CNN 情绪数据缺失' },
      ],
    };

    const html = renderToStaticMarkup(<SymbolVerdictCard snapshot={snapshotWith(missing)} symbol="TQQQ" />);

    expect(html).toContain('⚠');
    expect(html).toContain('（因数据缺失而未拦截，非真实通过）');
    expect(html).not.toContain('✓');
  });

  it('describes a BUY verdict as satisfied conditions, never as an action', () => {
    const avgo: QuantFinalVerdict = {
      symbol: 'AVGO',
      verdict: 'BUY',
      single_sentence: '条件完整',
      layers: [
        { layer: 'gates_six', label: '价格与估值', state: 'passed', reason: '价格与估值 1/1 已通过' },
      ],
    };

    const html = renderToStaticMarkup(<SymbolVerdictCard snapshot={snapshotWith(avgo)} symbol="AVGO" />);

    expect(html).toContain('五层条件均已满足');
    expect(html).not.toContain('建议');
    expect(html).not.toContain('可买');
    expect(html).not.toContain('买入');
  });

  it('says 数据缺失 for an undecidable verdict and 待更新 when the symbol has none', () => {
    const undecidable: QuantFinalVerdict = { symbol: 'FAS', verdict: 'UNDECIDABLE', layers: [] };

    expect(renderToStaticMarkup(<SymbolVerdictCard snapshot={snapshotWith(undecidable)} symbol="FAS" />))
      .toContain('数据缺失，无法判定');
    expect(renderToStaticMarkup(<SymbolVerdictCard snapshot={snapshotWith(undecidable)} symbol="UPRO" />))
      .toContain('待更新');
  });
});
