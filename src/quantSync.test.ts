import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyQuantSync, fetchQuantPositions, isQuantSnapshotStale, mapQuantPositions } from './quantSync';
import type { PortfolioState, QuantPositionsPayload } from './types';

const payload: QuantPositionsPayload = {
  as_of: '2026-07-15T07:00:00+08:00',
  currency: 'USD',
  net_liquidation: 135_481.26,
  broker: 'all',
  position_count_by_broker: { ibkr: 1, longbridge: 1, futu: 1 },
  positions: [
    { broker: 'ibkr', symbol: 'MSFT', asset_type: 'stock', qty: 20, market_value: 55_084.96 },
    { broker: 'longbridge', symbol: 'SGOV', asset_type: 'etf', qty: 77, market_value: 7_762 },
    { broker: 'futu', symbol: 'IGV', asset_type: 'option', qty: 2, market_value: 3_616 },
  ],
};

function prior(overrides: Partial<PortfolioState> = {}): PortfolioState {
  return {
    holdings: [],
    cash: [],
    updatedAt: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('mapQuantPositions', () => {
  it('maps the three-broker sample and derives one cash balance from net liquidation', () => {
    const mapped = mapQuantPositions(payload, prior());

    expect(mapped.holdings).toHaveLength(3);
    expect(mapped.holdings.map(({ symbol, assetType, broker }) => ({ symbol, assetType, broker }))).toEqual([
      { symbol: 'MSFT', assetType: 'stock', broker: 'IBKR' },
      { symbol: 'SGOV', assetType: 'etf', broker: 'LONGBRIDGE' },
      { symbol: 'IGV', assetType: 'option', broker: 'FUTU' },
    ]);
    expect(mapped.holdings[0]).toMatchObject({ shares: 20, marketValueOverride: 55_084.96, currency: 'USD', source: 'quant-sync' });
    expect(mapped.cash).toEqual([
      expect.objectContaining({ amount: 69_018.3, currency: 'USD', source: 'quant-sync' }),
    ]);
  });

  it('retains option Greeks and user enhancements while replacing quantity and market value', () => {
    const mapped = mapQuantPositions(payload, prior({
      holdings: [{
        id: 'old-igv', symbol: 'IGV', name: 'IGV 2027 Call', shares: 1, buyPrice: 7.2,
        currentPrice: 17.78, sector: '科技', currency: 'USD', assetType: 'option',
        option: {
          underlying: 'IGV', optionType: 'call', strike: 80, expiration: '2027-01-15',
          contractMultiplier: 100, delta: 0.8024, theta: -0.0231, gamma: 0.012,
          vega: 0.188, impliedVolatility: 0.3438, underlyingPrice: 94.59,
        },
        costOverride: 720, cashEquivalent: false, reportedPnl: 200, source: 'image-import',
      }],
    }));
    const igv = mapped.holdings.find((holding) => holding.symbol === 'IGV');

    expect(igv).toMatchObject({
      shares: 2,
      marketValueOverride: 3_616,
      currentPrice: 18.08,
      buyPrice: 7.2,
      costOverride: 720,
      sector: '科技',
      reportedPnl: 200,
      option: { delta: 0.8024, expiration: '2027-01-15', contractMultiplier: 100 },
    });
  });

  it('does not guess which option enhancement to copy when one underlying has multiple contracts', () => {
    const oldOption = (id: string, strike: number) => ({
      id, symbol: 'IGV', name: `IGV ${strike} Call`, shares: 1, buyPrice: 10, currentPrice: 18,
      sector: '科技', currency: 'USD' as const, assetType: 'option' as const, source: 'image-import' as const,
      option: {
        underlying: 'IGV', optionType: 'call' as const, strike, expiration: '2027-01-15',
        contractMultiplier: 100, delta: 0.8, theta: null, gamma: null, vega: null,
        impliedVolatility: null, underlyingPrice: 94,
      },
    });
    const mapped = mapQuantPositions(payload, prior({ holdings: [oldOption('a', 80), oldOption('b', 90)] }));
    const igv = mapped.holdings.find((holding) => holding.symbol === 'IGV');

    expect(igv?.option).toBeUndefined();
    expect(mapped.issues).toContainEqual(expect.objectContaining({ field: 'IGV 期权增强', priority: 'required' }));
  });

  it('uses the canonical leverage factor instead of a stale screenshot override', () => {
    const mapped = mapQuantPositions({
      ...payload,
      net_liquidation: 1_000,
      positions: [{ broker: 'ibkr', symbol: 'NVDL', asset_type: 'etf', qty: 10, market_value: 1_000 }],
    }, prior({
      holdings: [{
        id: 'nvdl', symbol: 'NVDL', name: 'NVDL', shares: 5, buyPrice: 80,
        currentPrice: 90, sector: '科技', currency: 'USD', assetType: 'leveraged_etf',
        leverageFactor: 1.5, source: 'image-import',
      }],
    }));

    expect(mapped.holdings[0]).toMatchObject({
      assetType: 'leveraged_etf',
      leverageFactor: 2,
      name: 'NVDL 2× 杠杆 ETF',
    });
  });

  it('keeps a signed reconciliation adjustment so total value equals net liquidation', () => {
    const mapped = mapQuantPositions({ ...payload, net_liquidation: 10_000 }, prior());
    const positionValue = payload.positions.reduce((sum, position) => sum + position.market_value, 0);

    expect(mapped.cash).toEqual([
      expect.objectContaining({
        amount: Math.round((10_000 - positionValue) * 100) / 100,
        note: expect.stringContaining('净值对账调整'),
      }),
    ]);
    expect(mapped.issues).toContainEqual(expect.objectContaining({ field: '现金推算', priority: 'required' }));
  });

  it('always preserves option type before applying the leveraged-symbol map', () => {
    const mapped = mapQuantPositions({
      ...payload,
      net_liquidation: 4_000,
      positions: [
        { broker: 'ibkr', symbol: 'MSFU', asset_type: 'etf', qty: 30, market_value: 700 },
        { broker: 'ibkr', symbol: 'MSFU', asset_type: 'option', qty: 2, market_value: 560 },
        { broker: 'futu', symbol: 'MSFU', asset_type: 'option', qty: 1, market_value: 200 },
        { broker: 'futu', symbol: 'MSFU', asset_type: 'etf', qty: 113, market_value: 2_540 },
      ],
    }, prior({
      holdings: [{
        id: 'stale-msfu', symbol: 'MSFU', name: 'DIREXION DAILY MSFT BULL 3X', shares: 10,
        buyPrice: 20, currentPrice: 25, sector: '科技', currency: 'USD',
        assetType: 'leveraged_etf', leverageFactor: 3, source: 'image-import',
      }],
    }));

    expect(mapped.holdings.map((holding) => holding.assetType)).toEqual([
      'leveraged_etf', 'option', 'option', 'leveraged_etf',
    ]);
    expect(mapped.holdings.filter((holding) => holding.assetType === 'leveraged_etf')).toEqual([
      expect.objectContaining({ name: 'MSFU 2× 杠杆 ETF', leverageFactor: 2 }),
      expect.objectContaining({ name: 'MSFU 2× 杠杆 ETF', leverageFactor: 2 }),
    ]);
  });

  it('classifies the complete 25-row broker snapshot without changing its cardinality', () => {
    const positions: QuantPositionsPayload['positions'] = [
      ['ibkr', 'FNGU', 'etf'], ['ibkr', 'GDX', 'etf'], ['ibkr', 'MAGS', 'etf'],
      ['ibkr', 'MSFU', 'etf'], ['ibkr', 'NVDA', 'stock'], ['ibkr', 'NVDL', 'etf'],
      ['ibkr', 'SGOV', 'etf'], ['ibkr', 'SPXL', 'stock'], ['ibkr', 'TQQQ', 'etf'],
      ['ibkr', 'TSLA', 'stock'], ['ibkr', 'TSLL', 'stock'], ['ibkr', 'UDOW', 'stock'],
      ['ibkr', 'MSFT', 'option'], ['ibkr', 'MSFU', 'option'], ['ibkr', 'NKE', 'option'],
      ['ibkr', 'NVDA', 'option'], ['ibkr', 'PDD', 'option'],
      ['longport', 'NVDA', 'stock'], ['longport', 'MSFT', 'stock'], ['longport', 'IGV', 'etf'],
      ['futu', 'NVDA', 'stock'], ['futu', 'MSFU', 'option'], ['futu', 'MSFU', 'etf'],
      ['futu', 'MSFT', 'stock'], ['futu', 'IGV', 'option'],
    ].map(([broker, symbol, asset_type]) => ({
      broker, symbol, asset_type: asset_type as 'stock' | 'etf' | 'option', qty: 1, market_value: 1,
    }));
    const mapped = mapQuantPositions({ ...payload, positions, net_liquidation: 25 }, prior());
    const counts = mapped.holdings.reduce<Record<string, number>>((result, holding) => {
      const type = holding.assetType ?? 'stock';
      result[type] = (result[type] ?? 0) + 1;
      return result;
    }, {});

    expect(mapped.holdings).toHaveLength(25);
    expect(counts).toEqual({ leveraged_etf: 8, etf: 4, stock: 6, option: 7 });
  });
});

describe('applyQuantSync', () => {
  it('replaces prior synced and screenshot entries but preserves manual holdings and cash', () => {
    const manualHolding = {
      id: 'manual', symbol: 'MSFT', name: 'manual MSFT', shares: 1, buyPrice: 100,
      currentPrice: 200, sector: '科技', currency: 'USD' as const, source: 'manual' as const,
    };
    const mapped = mapQuantPositions(payload, prior({ holdings: [manualHolding] }));
    const current = prior({
      holdings: [
        manualHolding,
        { ...manualHolding, id: 'old-quant', symbol: 'OLD', source: 'quant-sync' },
        { ...manualHolding, id: 'old-image', symbol: 'IMAGE', source: 'image-import' },
      ],
      cash: [
        { amount: 100, currency: 'USD', source: 'manual' },
        { amount: 200, currency: 'USD', source: 'quant-sync' },
        { amount: 300, currency: 'USD', source: 'image-import' },
      ],
    });
    const next = applyQuantSync(current, mapped);

    expect(next.holdings.map((holding) => holding.symbol)).toEqual(['MSFT', 'MSFT', 'SGOV', 'IGV']);
    expect(next.cash.map((cash) => cash.amount)).toEqual([100, 69_018.3]);
    expect(mapped.issues).toContainEqual(expect.objectContaining({ field: 'MSFT 重复持仓' }));
  });
});

describe('isQuantSnapshotStale', () => {
  it('is fresh at 89 minutes and stale at 91 minutes', () => {
    const pushedAt = '2026-07-15T10:00:00.000Z';

    expect(isQuantSnapshotStale(pushedAt, Date.parse('2026-07-15T11:29:00.000Z'))).toBe(false);
    expect(isQuantSnapshotStale(pushedAt, Date.parse('2026-07-15T11:31:00.000Z'))).toBe(true);
  });

  it('treats an invalid timestamp as stale', () => {
    expect(isQuantSnapshotStale('not-a-date')).toBe(true);
  });
});

describe('fetchQuantPositions cross-device access', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads the shared VPS snapshot without a browser-local token', async () => {
    const snapshot = { payload, pushed_at: '2026-07-15T10:00:00.000Z', source: 'futu-assistant' as const };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchQuantPositions('http://example.test/api/portfolio/positions', '')).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledWith('http://example.test/api/portfolio/positions', { headers: {} });
  });

  it('still sends a token when a legacy browser already has one', async () => {
    const snapshot = { payload, pushed_at: '2026-07-15T10:00:00.000Z', source: 'futu-assistant' as const };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchQuantPositions('http://example.test/api/portfolio/positions', 'legacy-token');
    expect(fetchMock).toHaveBeenCalledWith('http://example.test/api/portfolio/positions', {
      headers: { Authorization: 'Bearer legacy-token' },
    });
  });
});
