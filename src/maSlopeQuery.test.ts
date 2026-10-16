import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchChannelReview, fetchMaSlopeDashboard, fetchMaSlopeQuery, normalizeMaSlopeSymbol } from './maSlopeQuery';

afterEach(() => vi.unstubAllGlobals());

describe('ma slope query client', () => {
  it('normalizes supported symbols and rejects unsafe input before requesting', () => {
    expect(normalizeMaSlopeSymbol(' brk.b ')).toBe('BRK.B');
    expect(normalizeMaSlopeSymbol('^ndx')).toBe('^NDX');
    expect(() => normalizeMaSlopeSymbol('AAPL/../../x')).toThrow('股票代码格式');
  });

  it('requests one encoded symbol and parses the server result', async () => {
    const result = {
      symbol: 'AMD', available: true, annualized_pct: 12.3,
      model: 'ma200_20d_annualized', role: 'trend_context_only', buy_veto: false,
      ma_period: 200, change_window_sessions: 20, annualization_sessions: 252,
      current_ma: 100, comparison_ma: 99, direction: 'up', regime: 'strong_up',
      label: '强势上涨', as_of: '2026-08-19', price_adjustment: 'adjusted',
      data_source: 'Yahoo Finance adjusted daily', formula: 'formula', reason: 'reason',
      series: [], decision_use: false,
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMaSlopeQuery('/api/portfolio/ma-slope', 'amd')).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith('/api/portfolio/ma-slope?symbol=AMD', {
      cache: 'no-store', signal: undefined,
    });
  });

  it('surfaces the server error next to the query control', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: '找不到该股票或历史行情不足' },
    }), { status: 422, headers: { 'Content-Type': 'application/json' } })));

    await expect(fetchMaSlopeQuery('/api/portfolio/ma-slope', 'NONE'))
      .rejects.toThrow('找不到该股票或历史行情不足');
  });

  it('requests the original multi-MA chart with its range and slope lookback', async () => {
    const dashboard = { symbol: 'AMD', available: true, dashboard: { series: [] } };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(dashboard), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMaSlopeDashboard('/api/portfolio/ma-slope', 'amd', {
      range: '5y', slopeWindow: 5,
    })).resolves.toEqual(dashboard);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/portfolio/ma-slope?symbol=AMD&view=dashboard&range=5y&slope_window=5',
      { cache: 'no-store', signal: undefined },
    );
  });

  it('can explicitly bypass the dashboard cache for a manual or timed refresh', async () => {
    const dashboard = { symbol: 'NVDA', available: true, dashboard: { series: [] } };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(dashboard), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchMaSlopeDashboard('/api/portfolio/ma-slope', 'nvda', {
      range: '1y', slopeWindow: 8, refresh: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/portfolio/ma-slope?symbol=NVDA&view=dashboard&range=1y&slope_window=8&refresh=1',
      { cache: 'no-store', signal: undefined },
    );
  });

  it('loads the fixed daily channel review used to color ticker buttons', async () => {
    const review = {
      review_time: '16:20', timezone: 'America/New_York', review_date: '2026-08-20',
      updated_at: '2026-08-20T20:20:00Z', symbols: { META: { state: 'buy', label: '可以买' } },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(review), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchChannelReview('/api/portfolio/channel-alerts')).resolves.toEqual(review);
    expect(fetchMock).toHaveBeenCalledWith('/api/portfolio/channel-alerts', {
      cache: 'no-store', signal: undefined,
    });
  });
});
