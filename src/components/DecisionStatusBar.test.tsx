import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { QuantAnalysisSnapshot } from '../types';
import { DecisionStatusBar } from './DecisionStatusBar';

describe('DecisionStatusBar', () => {
  it.each([
    {
      name: 'all NO_BUY',
      verdicts: ['NO_BUY', 'NO_BUY'],
      expected: '今日结论：不买 2',
    },
    {
      name: 'NO_BUY plus UNDECIDABLE',
      verdicts: [...Array(24).fill('NO_BUY'), ...Array(4).fill('UNDECIDABLE')],
      expected: '今日结论：不买 24 · 无法判定 4',
    },
    {
      name: 'BUY plus NO_BUY',
      verdicts: ['BUY', 'NO_BUY', 'NO_BUY'],
      expected: '今日结论：条件完整 1 · 不买 2',
    },
    {
      name: 'empty',
      verdicts: [],
      expected: '今日结论：数据不足，无法判定',
    },
  ])('summarises $name verdicts without erasing known decisions', ({ verdicts, expected }) => {
    const finalVerdict = Object.fromEntries(verdicts.map((verdict, index) => [
      `S${index}`,
      { symbol: `S${index}`, verdict, single_sentence: String(verdict), layers: [] },
    ]));
    const snapshot = {
      source: 'futu-assistant', generated_at: '2026-07-30T12:00:00-04:00',
      rule_version: '2.7', disclaimer: 'display only', context: {}, symbols: {},
      final_verdict: finalVerdict,
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(<DecisionStatusBar snapshot={snapshot} />);

    expect(html).toContain(expected);
  });

  it('keeps the per-symbol verdict list collapsed by default on the dashboard', () => {
    const snapshot = {
      source: 'futu-assistant', generated_at: '2026-07-30T12:00:00-04:00',
      rule_version: '2.7', disclaimer: 'display only', context: {}, symbols: {},
      final_verdict: {
        AAPL: { symbol: 'AAPL', verdict: 'NO_BUY', single_sentence: '不买', layers: [] },
        SOXL: { symbol: 'SOXL', verdict: 'NO_BUY', single_sentence: '不买', layers: [] },
      },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(<DecisionStatusBar snapshot={snapshot} />);

    expect(html).toContain('<details');
    expect(html).toContain('查看 2 个标的明细');
    expect(html).not.toContain('<details open="">');
  });

  it('renders the backend final verdict as the only top-level conclusion and surfaces stale data', () => {
    const snapshot = {
      source: 'futu-assistant',
      generated_at: '2026-07-30T12:00:00-04:00',
      rule_version: '2.7',
      disclaimer: 'display only',
      context: {},
      symbols: {},
      final_verdict: {
        SOXL: {
          symbol: 'SOXL',
          verdict: 'NO_BUY',
          single_sentence: '不买：基准 SOXX 还需再跌 25.4% 到 $393.01，且科技板块已超硬顶 $22,771',
          is_silence_by_rule: true,
          data_as_of: '2026-07-27',
          data_stale_days: 3,
          data_stale: true,
          blocking_layers: [],
          passing_layers: [],
          unknown_layers: [],
          layers: [],
        },
      },
      ammo_overview: {
        cash_exposure: { available_usd: 28_708 },
        buying_power: { by_3x_usd: 0 },
      },
      freshness: {
        positions_as_of: '2026-07-27',
        prices_at: '2026-07-30T12:00:00-04:00',
        price_session: 'regular',
        valuation_as_of: '2026-07-27',
        cnn_as_of: '2026-07-27',
        regime_evaluated_at: '2026-07-30T12:00:00-04:00',
        sell_evaluated_at: '2026-07-30T12:00:00-04:00',
        buy_plan_evaluated_at: '2026-07-30T12:00:00-04:00',
        data_stale: true,
        stale_days: 3,
        data_as_of: '2026-07-27',
      },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(<DecisionStatusBar snapshot={snapshot} />);

    expect(html).toContain('今日结论：不买');
    expect(html).toContain('不是系统故障');
    expect(html).toContain('数据 2026-07-27（落后 3 天）');
    expect(html).toContain('可用资金 $28,708.00 · 闸门放行 $0.00');
    expect(html).toContain('SOXL');
    expect(html).not.toContain('当前 0 个标的达到买入条件');
  });

  it('does not synthesize a top-level verdict from legacy buy or sell summaries', () => {
    const snapshot = {
      source: 'futu-assistant',
      generated_at: '2026-07-26T11:49:37-04:00',
      rule_version: '2.2',
      disclaimer: 'display only',
      context: {},
      symbols: {},
      summary: {
        buy_ready: [{ symbol: 'TQQQ' }, { symbol: 'SOXL' }],
        buy_near: [],
        sell_ready: [],
        idle_symbols: [],
        idle_count: 0,
        depth_states: {},
        generated_at: '2026-07-26T11:49:37-04:00',
      },
      sell: {
        shadow: false,
        symbols: {
          GDX: { profit_gate: { verdict: 'hold_loss' } },
          FNGU: { profit_gate: { verdict: 'hold_below_ladder' } },
          MSFT: { profit_gate: { verdict: 'ladder_active' } },
        },
      },
      freshness: {
        positions_as_of: '2026-07-23',
        prices_at: '2026-07-26T11:49:37-04:00',
        price_session: 'regular',
        valuation_as_of: '2026-07-24',
        cnn_as_of: '2026-07-24',
        regime_evaluated_at: '2026-07-26T11:49:37-04:00',
        sell_evaluated_at: '2026-07-26T11:49:37-04:00',
        buy_plan_evaluated_at: '2026-07-26T11:49:37-04:00',
      },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(<DecisionStatusBar snapshot={snapshot} />);

    expect(html).toContain('今日结论：数据不足，无法判定');
    expect(html).toContain('等待下一份量化快照生成最终裁决');
    expect(html).not.toContain('当前 2 个标的达到买入条件');
    expect(html).toContain('持仓 2026-07-23');
    expect(html).toContain('价格 2026-07-26');
  });

  it('uses wrapper-level final-verdict freshness when individual verdicts omit stale fields', () => {
    const snapshot = {
      source: 'futu-assistant', generated_at: '2026-07-30T12:00:00-04:00', rule_version: '2.7', disclaimer: 'display only', context: {}, symbols: {},
      final_verdict: {
        symbols: { SOXL: { symbol: 'SOXL', verdict: 'NO_BUY' } },
        data_stale: true,
        stale_days: 4,
        data_as_of: '2026-07-26',
      },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(<DecisionStatusBar snapshot={snapshot} />);

    expect(html).toContain('今日结论：不买');
    expect(html).toContain('数据 2026-07-26（落后 4 天）');
    expect(html).toContain('后端未提供结论说明。');
  });

  it('surfaces positive stale days even when the server stale boolean is false', () => {
    const snapshot = {
      source: 'futu-assistant', generated_at: '2026-07-30T12:00:00-04:00',
      rule_version: '2.7', disclaimer: 'display only', context: {}, symbols: {},
      final_verdict: {
        symbols: { SOXL: { symbol: 'SOXL', verdict: 'NO_BUY' } },
        data_stale: false,
        stale_days: 2,
        data_as_of: '2026-07-28',
      },
      freshness: {
        data_stale: false,
        stale_days: 2,
        max_stale_days: 2,
        data_as_of: '2026-07-28',
      },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(<DecisionStatusBar snapshot={snapshot} />);

    expect(html).toContain('数据 2026-07-28（落后 2 天）');
  });

  it('shows the server-rendered silence broadcast verbatim so it matches the push', () => {
    const snapshot = {
      source: 'futu-assistant', generated_at: '2026-07-30T12:00:00-04:00',
      rule_version: '2.7', disclaimer: '', context: {}, symbols: {},
      final_verdict: { symbols: { SOXL: { symbol: 'SOXL', verdict: 'NO_BUY' } } },
      silence_broadcast: {
        title: '📋 今日结论：不买（不是漏报，是规则说不买）',
        body: '📋 今日结论：不买（不是漏报，是规则说不买）\nSOXL 🛑 未达 -40%\n      → 需要：SOXX 跌到 $393.01\n\n今日不买是规则的结论，不是系统故障。',
        is_silence_by_rule: true,
      },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(<DecisionStatusBar snapshot={snapshot} />);

    expect(html).toContain('今日播报（与手机推送同一份）');
    expect(html).toContain('需要：SOXX 跌到 $393.01');
    expect(html).toContain('今日不买是规则的结论，不是系统故障。');
  });

  it('treats max_stale_days as a tolerance, not as an age', () => {
    const snapshot = {
      source: 'futu-assistant', generated_at: '2026-07-30T12:00:00-04:00',
      rule_version: '2.7', disclaimer: '', context: {}, symbols: {},
      final_verdict: { symbols: { SOXL: { symbol: 'SOXL', verdict: 'NO_BUY' } } },
      freshness: { data_stale: false, stale_days: 0, max_stale_days: 2, data_as_of: '2026-07-30' },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(<DecisionStatusBar snapshot={snapshot} />);

    expect(html).not.toContain('落后');
  });

  it('shows funding facts with two-decimal money precision', () => {
    const snapshot = {
      source: 'futu-assistant', generated_at: '2026-07-30', rule_version: '2.7',
      disclaimer: '', context: {}, symbols: {},
      ammo_overview: {
        cash_exposure: { available_usd: 28_717.47 },
        buying_power: { by_3x_usd: 12.3 },
      },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(<DecisionStatusBar snapshot={snapshot} />);

    expect(html).toContain('可用资金 $28,717.47 · 闸门放行 $12.30');
  });

  it('names the nearest symbol with its blocking layers and the price it waits for', () => {
    const snapshot = {
      source: 'futu-assistant', generated_at: '2026-07-30T12:00:00-04:00',
      rule_version: '2.7', disclaimer: '', context: {}, symbols: {},
      final_verdict: {
        symbols: {
          SOXL: {
            symbol: 'SOXL', verdict: 'NO_BUY',
            layers: [
              { layer: 'gates_six', state: 'failed' },
              { layer: 'entry_gate_1x', state: 'failed', benchmark: 'SOXX', gap_pp: 10.99128, trigger_price: 393.006 },
              { layer: 'sleeve_borrow', state: 'failed' },
              { layer: 'buy_plan_conditions', state: 'failed' },
              { layer: 'panic_window', state: 'failed' },
            ],
          },
          AAPL: {
            symbol: 'AAPL', verdict: 'NO_BUY',
            layers: [
              { layer: 'gates_six', state: 'failed', reason: '六关未通过：低位、形态' },
              { layer: 'entry_gate_1x', state: 'not_applicable' },
              { layer: 'sleeve_borrow', state: 'passed' },
              { layer: 'buy_plan_conditions', state: 'not_applicable' },
              { layer: 'panic_window', state: 'not_applicable' },
            ],
          },
        },
      },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(<DecisionStatusBar snapshot={snapshot} />);

    expect(html).toContain('最接近的是 ');
    expect(html.replace(/<[^>]*>/g, '')).toContain('最接近的是 AAPL —— 5 层已过 4 层，仅差 六关');
    expect(html).toContain('需要：SOXX 跌到 $393.01（还差 10.99pp）');
  });

  it('gives every listed symbol its own price-denominated requirement', () => {
    const snapshot = {
      source: 'futu-assistant', generated_at: '2026-07-30T12:00:00-04:00',
      rule_version: '2.7', disclaimer: '', context: {}, symbols: {},
      final_verdict: {
        symbols: {
          SOXL: {
            symbol: 'SOXL', verdict: 'NO_BUY', single_sentence: '不买',
            layers: [{ layer: 'entry_gate_1x', state: 'failed', benchmark: 'SOXX', gap_pp: 10.99128, trigger_price: 393.006 }],
          },
          TECL: {
            symbol: 'TECL', verdict: 'NO_BUY', single_sentence: '不买',
            layers: [{ layer: 'entry_gate_1x', state: 'failed', benchmark: 'XLK', gap_pp: 0, trigger_price: 176.19687 }],
          },
        },
      },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(<DecisionStatusBar snapshot={snapshot} />);

    expect(html).toContain('需要：SOXX 跌到 $393.01（还差 10.99pp）');
    expect(html).toContain('需要：XLK 跌到 $176.20（还差 0.00pp）');
  });

  it('states the rule-silence reassurance once instead of once per symbol', () => {
    const silent = (symbol: string) => ({ symbol, verdict: 'NO_BUY', single_sentence: '不买', is_silence_by_rule: true, layers: [] });
    const snapshot = {
      source: 'futu-assistant', generated_at: '2026-07-30T12:00:00-04:00',
      rule_version: '2.7', disclaimer: '', context: {}, symbols: {},
      final_verdict: { symbols: { AAPL: silent('AAPL'), SOXL: silent('SOXL'), TQQQ: silent('TQQQ') } },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(<DecisionStatusBar snapshot={snapshot} />);

    expect(html.split('不是系统故障').length - 1).toBe(1);
    expect(html).toContain('今日不买是规则的结论，不是系统故障。');
  });

  it('drops the duplicated 另有 clause the backend repeats in single_sentence', () => {
    const snapshot = {
      source: 'futu-assistant', generated_at: '2026-07-30T12:00:00-04:00',
      rule_version: '2.7', disclaimer: '', context: {}, symbols: {},
      final_verdict: {
        symbols: {
          AAPL: {
            symbol: 'AAPL', verdict: 'NO_BUY',
            single_sentence: '不买：六关未通过：低位、形态；另有六关未通过：低位、形态',
            layers: [],
          },
        },
      },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(<DecisionStatusBar snapshot={snapshot} />);

    expect(html).toContain('不买：六关未通过：低位、形态');
    expect(html).not.toContain('另有六关未通过');
  });

  it('uses calm neutral copy when no server-owned final verdict is available', () => {
    const snapshot = {
      source: 'futu-assistant',
      generated_at: '2026-07-26T11:49:37-04:00',
      rule_version: '2.2',
      disclaimer: 'display only',
      context: {},
      symbols: {},
      summary: {
        buy_ready: [],
        buy_near: [],
        sell_ready: [],
        idle_symbols: [],
        idle_count: 0,
        depth_states: {},
        generated_at: '2026-07-26T11:49:37-04:00',
      },
      sell: { shadow: true, symbols: {} },
    } as unknown as QuantAnalysisSnapshot;

    const html = renderToStaticMarkup(<DecisionStatusBar snapshot={snapshot} />);
    expect(html).toContain('今日结论：数据不足，无法判定');
    expect(html).toContain('页面不会自行拼接买入结论');
  });
});
