import { describe, expect, it } from 'vitest';
import { analyzePortfolio } from './analyzer';
import { computeMetrics } from './metrics';
import { crossCheckImportedPnl } from './importMerge';
import type { ExchangeRates, Holding, ImportIssue, PortfolioState } from './types';

const usdRates: ExchangeRates = {
  USD: 1, CNY: 7, HKD: 7.8, JPY: 155, EUR: 0.92, GBP: 0.79, updatedAt: null, source: 'fallback',
};

function holding(symbol: string, value: number, overrides: Partial<Holding> = {}): Holding {
  return {
    id: symbol,
    symbol,
    name: symbol,
    shares: value,
    buyPrice: 1,
    currentPrice: 1,
    sector: '科技',
    currency: 'USD',
    assetType: 'stock',
    ...overrides,
  };
}

function findingsFor(holdings: Holding[], cash = 0, exposureTargetPct = 100) {
  const state: PortfolioState = {
    holdings,
    cash: cash > 0 ? [{ amount: cash, currency: 'USD' }] : [],
    updatedAt: '2026-07-14T00:00:00.000Z',
  };
  return analyzePortfolio(computeMetrics(state, usdRates), exposureTargetPct);
}

describe('analyzePortfolio data-quality aware risk scan', () => {
  it('exempts a 40% SGOV position from single-stock concentration', () => {
    const findings = findingsFor([
      holding('SGOV', 40, { assetType: 'etf', sector: 'ETF / 指数' }),
      holding('AAPL', 20),
      holding('MSFT', 20),
      holding('NVDA', 20),
    ]);

    expect(findings.some((item) => item.level === 'critical' && item.title.includes('SGOV'))).toBe(false);
    expect(findings.some((item) => item.level === 'info' && item.title.includes('现金类 ETF'))).toBe(true);
  });

  it('treats 95% unclassified holdings as missing data instead of sector concentration', () => {
    const findings = findingsFor([
      holding('AAPL', 95, { sector: '未分类' }),
    ], 5);

    expect(findings.some((item) => item.title.includes('未分类 行业过度集中'))).toBe(false);
    expect(findings.some((item) => item.level === 'info' && item.title.includes('持仓缺少行业分类'))).toBe(true);
  });

  it('uses 44% total liquidity instead of reporting 4% cash as too low', () => {
    const findings = findingsFor([
      holding('SGOV', 40, { assetType: 'etf', sector: 'ETF / 指数' }),
      holding('AAPL', 28),
      holding('MSFT', 28),
    ], 4);

    expect(findings.some((item) => item.title.includes('仓位过低'))).toBe(false);
  });

  it('does not report a screenshot loss when confidence is low', () => {
    const findings = findingsFor([
      holding('NVDA', 30, {
        shares: 1,
        buyPrice: 100,
        currentPrice: 30,
        confidence: 'low',
        source: 'image-import',
      }),
    ], 70);

    expect(findings.some((item) => item.title.includes('NVDA 浮亏'))).toBe(false);
  });

  it('deduplicates incomplete-option findings for the same symbol', () => {
    const incompleteOption = holding('IGV', 100, {
      assetType: 'option',
      shares: 1,
      buyPrice: 1,
      currentPrice: 1,
      option: {
        underlying: 'IGV', optionType: 'call', strike: 80, expiration: null,
        contractMultiplier: 100, delta: null, theta: null, gamma: null, vega: null,
        impliedVolatility: null, underlyingPrice: 95,
      },
    });
    const findings = findingsFor([
      incompleteOption,
      { ...incompleteOption, id: 'IGV-second' },
    ]);

    expect(findings.filter((item) => item.title === 'IGV 期权数据不完整')).toHaveLength(1);
  });

  it('replaces a false NVDA loss warning with a required reconciliation issue', () => {
    const issues: ImportIssue[] = [];
    const checked = crossCheckImportedPnl({
      ...holding('NVDA', 30, { source: 'image-import', confidence: 'high' }),
      id: undefined,
      shares: 1,
      buyPrice: 102,
      currentPrice: 30,
      marketValueOverride: 30,
      costOverride: 102,
      reportedPnl: 10,
    } as Omit<Holding, 'id'>, issues);
    const findings = findingsFor([{ ...checked, id: 'nvda' }], 70);

    expect(checked.confidence).toBe('low');
    expect(checked.missingFields).toContain('成本待核对');
    expect(issues.some((item) => item.priority === 'required' && item.field.includes('成本待核对'))).toBe(true);
    expect(findings.some((item) => item.title.includes('NVDA 浮亏'))).toBe(false);
  });

  it('does not emit leveraged ETF noise for TQQQ or NVDL', () => {
    const findings = findingsFor([
      holding('TQQQ', 10, { assetType: 'leveraged_etf' }),
      holding('NVDL', 10, { assetType: 'leveraged_etf' }),
      holding('AAPL', 30),
      holding('MSFT', 30),
    ], 20);

    expect(findings.some((item) => item.title.includes('为杠杆 ETF'))).toBe(false);
  });
});

describe('equivalent exposure target reminders', () => {
  function exposureFinding(exposurePct: number, cashOverride?: number) {
    const leveraged = exposurePct > 100;
    const marketValue = leveraged ? exposurePct / 2 : exposurePct;
    const cash = cashOverride ?? 100 - marketValue;
    return findingsFor([holding(leveraged ? 'TSLL' : 'MSFT', marketValue, leveraged ? { assetType: 'leveraged_etf' } : {})], cash, 100)
      .find((finding) => finding.title.startsWith('等效仓位'));
  }

  it('reports 85% as planned undeployed cash at info level', () => {
    expect(exposureFinding(85)).toEqual(expect.objectContaining({ level: 'info', title: expect.stringContaining('85.0% 低于目标 100%') }));
  });

  it('reports 115% as above-target leverage at warn level', () => {
    expect(exposureFinding(115)).toEqual(expect.objectContaining({ level: 'warn', title: expect.stringContaining('115.0% 高于目标 100%') }));
  });

  it('reports 145% as significantly above target at critical level', () => {
    expect(exposureFinding(145)).toEqual(expect.objectContaining({ level: 'critical', title: expect.stringContaining('145.0% 显著高于目标 100%') }));
  });

  it('does not emit a target reminder inside the 90–110% tolerance band', () => {
    expect(exposureFinding(95)).toBeUndefined();
    expect(exposureFinding(105)).toBeUndefined();
  });
});
