import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchQuantAnalysis,
  isQuantAnalysisStale,
  lookupQuantSymbol,
  parseQuantAnalysis,
  quantAnalysisFreshnessText,
  quantAnalysisAgeHours,
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
      monitoredSymbols: ['AAPL', 'SGOV', 'SOXL'],
    });
  });
});
