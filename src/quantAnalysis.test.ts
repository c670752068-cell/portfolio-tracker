import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchQuantAnalysis,
  finalVerdictFreshness,
  finalVerdictSymbols,
  isQuantAnalysisStale,
  lookupQuantSymbol,
  parseQuantAnalysis,
  quantAnalysisFreshnessText,
  quantAnalysisAgeHours,
  quantAnalysisRefreshMs,
  QUANT_ANALYSIS_MARKET_REFRESH_MS,
  QUANT_ANALYSIS_REFRESH_MS,
} from './quantAnalysis';
import { quantAnalysisFixture } from './testFixtures/quantAnalysis';

afterEach(() => vi.unstubAllGlobals());

describe('quant analysis contract', () => {
  it('parses the site-export payload without inventing a combined probability', () => {
    const parsed = parseQuantAnalysis(quantAnalysisFixture);

    expect(parsed.source).toBe('futu-assistant');
    expect(parsed.symbols.SOXL.gates_passed).toBe(4);
    expect(parsed.symbols.SOXL.gates_total).toBe(6);
    expect(JSON.stringify(parsed)).not.toContain('probability');
  });

  it('rejects a malformed backend panic-window contract', () => {
    const malformed = {
      ...quantAnalysisFixture,
      panic_window: { ...quantAnalysisFixture.panic_window, symbols: { SOXL: { applicable: true } } },
    };

    expect(() => parseQuantAnalysis(malformed)).toThrow('恐慌抢买窗口格式无效');
  });

  it('parses the wrapped server-owned final-verdict record without rebuilding it in the client', () => {
    const payload = {
      ...quantAnalysisFixture,
      final_verdict: {
        symbols: {
          SOXL: {
            symbol: 'SOXL',
            verdict: 'NO_BUY',
            single_sentence: '不买：1x 入场门尚未通过。',
            is_silence_by_rule: true,
            data_as_of: '2026-07-27',
            data_stale_days: 3,
            data_stale: true,
            blocking_layers: [{ layer: 'entry_gate_1x', reason: 'SOXX 未触及 MA120' }],
            passing_layers: ['gates_six'],
            unknown_layers: [],
            layers: [{ layer: 'entry_gate_1x', state: 'failed', passed: false, reason: 'SOXX 未触及 MA120', benchmark: 'SOXX', trigger_price: 393.01 }],
          },
        },
        data_stale: true,
        stale_days: 3,
        data_as_of: '2026-07-27',
      },
    };

    const parsed = parseQuantAnalysis(payload);

    expect(finalVerdictSymbols(parsed).SOXL).toMatchObject({
      verdict: 'NO_BUY',
      single_sentence: '不买：1x 入场门尚未通过。',
      data_stale: true,
    });
    expect(finalVerdictFreshness(parsed)).toEqual({
      data_stale: true,
      stale_days: 3,
      data_as_of: '2026-07-27',
    });
  });

  it('accepts a sparse server verdict but rejects malformed required verdict fields', () => {
    const sparse = {
      ...quantAnalysisFixture,
      final_verdict: { symbols: { SOXL: { symbol: 'SOXL', verdict: 'NO_BUY' } } },
    };
    expect(() => parseQuantAnalysis(sparse)).not.toThrow();

    const malformed = {
      ...quantAnalysisFixture,
      final_verdict: { symbols: { SOXL: { symbol: 'SOXL', verdict: 0 } } },
    };

    expect(() => parseQuantAnalysis(malformed)).toThrow('最终裁决格式无效');
  });

  it('loads the latest public snapshot with GET semantics', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(quantAnalysisFixture), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchQuantAnalysis('http://example.test/api/portfolio/quant-analysis'))
      .resolves.toEqual(quantAnalysisFixture);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://example.test/api/portfolio/quant-analysis',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('marks data stale only after it is more than 24 hours old', () => {
    const generatedAt = '2026-07-15T14:00:00.000Z';

    expect(isQuantAnalysisStale(generatedAt, Date.parse('2026-07-16T13:59:59.000Z'))).toBe(false);
    expect(isQuantAnalysisStale(generatedAt, Date.parse('2026-07-16T14:00:01.000Z'))).toBe(true);
    expect(isQuantAnalysisStale('not-a-date')).toBe(true);
  });

  it('reports whole elapsed hours for the stale-data banner', () => {
    const generatedAt = '2026-07-15T14:00:00.000Z';

    expect(quantAnalysisAgeHours(generatedAt, Date.parse('2026-07-16T15:59:59.000Z'))).toBe(25);
    expect(quantAnalysisAgeHours('not-a-date')).toBeNull();
  });

  it('formats the successful snapshot refresh timestamp and exact age in minutes', () => {
    expect(quantAnalysisFreshnessText(
      '2026-07-15T14:00:00.000Z',
      Date.parse('2026-07-15T14:12:59.000Z'),
    )).toBe('快照 2026-07-15 10:00 ET，12 分钟前');
  });

  it('normalizes a query and returns the monitored pool when the symbol is outside it', () => {
    expect(lookupQuantSymbol(quantAnalysisFixture, ' soxl ')).toMatchObject({
      found: true,
      symbol: 'SOXL',
      analysis: { gates_passed: 4, gates_total: 6 },
    });
    expect(lookupQuantSymbol(quantAnalysisFixture, 'amd')).toEqual({
      found: false,
      symbol: 'AMD',
      monitoredSymbols: ['AAPL', 'AMZN', 'SGOV', 'SOXL'],
    });
  });

  it('refreshes analysis every 5 minutes in regular session and every 25 minutes otherwise', () => {
    expect(quantAnalysisRefreshMs(new Date('2026-07-23T14:00:00.000Z')))
      .toBe(QUANT_ANALYSIS_MARKET_REFRESH_MS);
    expect(quantAnalysisRefreshMs(new Date('2026-07-23T22:00:00.000Z')))
      .toBe(QUANT_ANALYSIS_REFRESH_MS);
  });
});
