import { describe, expect, it } from 'vitest';
import {
  buildChannelAlert,
  buildYahooSlopeChartUrl,
  normalizeSlopeQuerySymbol,
  parseYahooSlopeDashboard,
  parseYahooSlopeHistory,
} from './ma-slope-query.mjs';

function yahooHistory(closes: number[]) {
  const start = Date.UTC(2024, 0, 2) / 1000;
  return {
    chart: {
      result: [{
        meta: { currency: 'USD' },
        timestamp: closes.map((_, index) => start + index * 86_400),
        indicators: {
          adjclose: [{ adjclose: closes }],
          quote: [{
            open: closes.map((value) => value - 0.5),
            high: closes.map((value) => value + 1),
            low: closes.map((value) => value - 1),
            close: closes,
            volume: closes.map((_, index) => 1_000_000 + index),
          }],
        },
      }],
    },
  };
}

function yahooHistoryEndingToday(closes: number[]) {
  const payload = yahooHistory(closes);
  const result = payload.chart.result[0];
  const lastTimestamp = Date.UTC(2026, 7, 20, 13, 30) / 1000;
  result.timestamp = closes.map((_, index) => lastTimestamp - (closes.length - 1 - index) * 86_400);
  Object.assign(result.meta, {
    regularMarketTime: Date.UTC(2026, 7, 20, 15, 30) / 1000,
    currentTradingPeriod: {
      regular: {
        start: Date.UTC(2026, 7, 20, 13, 30) / 1000,
        end: Date.UTC(2026, 7, 20, 20, 0) / 1000,
      },
    },
  });
  return payload;
}

describe('custom MA slope query', () => {
  it('classifies complete-close channel positions into green buy and red sell stages', () => {
    expect(buildChannelAlert({
      date: '2026-08-20', close: 80, band200: [90, 110], zscore200: -1.6,
    })).toMatchObject({ state: 'buy', signal: 'buy', label: '可以买', complete_close: true });
    expect(buildChannelAlert({
      date: '2026-08-20', close: 92, band200: [90, 110], zscore200: -1.3,
    })).toMatchObject({ state: 'buy_near', label: '接近买' });
    expect(buildChannelAlert({
      date: '2026-08-20', close: 108, band200: [90, 110], zscore200: 1.3,
    })).toMatchObject({ state: 'sell_near', label: '接近卖' });
    expect(buildChannelAlert({
      date: '2026-08-20', close: 112, band200: [90, 110], zscore200: 1.6,
    })).toMatchObject({ state: 'sell', signal: 'sell', label: '可以卖' });
  });

  it('normalizes safe US tickers and maps dots plus common indices for Yahoo', () => {
    expect(normalizeSlopeQuerySymbol(' brk.b ')).toBe('BRK.B');
    expect(buildYahooSlopeChartUrl('BRK.B')).toContain('/BRK-B?');
    expect(buildYahooSlopeChartUrl('NDX')).toContain('/%5ENDX?');
    expect(buildYahooSlopeChartUrl('SPX')).toContain('/%5EGSPC?');
    expect(buildYahooSlopeChartUrl('NVDA', '5y')).toContain('range=10y');
    expect(() => normalizeSlopeQuerySymbol('AAPL<script>')).toThrow('股票代码格式');
  });

  it('reproduces the original K-line dashboard with price, three MAs and three slope curves', () => {
    const closes = Array.from({ length: 230 }, (_, index) => index + 1);
    const result = parseYahooSlopeDashboard('TEST', yahooHistory(closes), {
      range: '5y', slopeWindow: 5, maPeriods: [20, 50, 200],
      now: new Date('2026-08-20T12:00:00Z'),
    });

    expect(result).toMatchObject({
      symbol: 'TEST', available: true, decision_use: false, buy_veto: false,
      data_source: 'Yahoo Finance raw daily OHLC',
      dashboard: {
        range: '5y', slope_window_sessions: 5, slope_unit: 'pct_per_day',
        ma_periods: [20, 50, 200], band_sigma: 1.5, z_score_period: 200,
      },
    });
    const latest = result.dashboard.series.at(-1);
    expect(latest).toMatchObject({
      close: 230, ma20: 220.5, ma50: 205.5, ma200: 130.5,
    });
    expect(latest.slope20).toBeCloseTo((220.5 / 215.5 - 1) * 100 / 5, 6);
    expect(latest.slope50).toBeCloseTo((205.5 / 200.5 - 1) * 100 / 5, 6);
    expect(latest.slope200).toBeCloseTo((130.5 / 125.5 - 1) * 100 / 5, 6);
    expect(latest.std200).toBeGreaterThan(0);
    expect(latest.band200).toEqual([
      expect.any(Number), expect.any(Number),
    ]);
    expect(latest.zscore200).toBeCloseTo((230 - 130.5) / latest.std200, 6);
    expect(result.dashboard.summary).toMatchObject({
      price: 230,
      ma200: 130.5,
      distance_to_ma200_pct: expect.any(Number),
      z_score: latest.zscore200,
      z_score_band: expect.any(String),
      ma200_slope_annualized_pct: expect.any(Number),
      ma200_trend: 'strong_up',
      ma200_trend_label: '强势上涨',
    });
  });

  it('reproduces the full MA200 20-session annualized model with a history series', () => {
    const result = parseYahooSlopeHistory(
      'TEST',
      yahooHistory([...Array(200).fill(100), ...Array(20).fill(200)]),
      { now: new Date('2026-08-20T12:00:00Z') },
    );

    expect(result).toMatchObject({
      symbol: 'TEST', available: true, model: 'ma200_20d_annualized',
      annualized_pct: 126, current_ma: 110, comparison_ma: 100,
      direction: 'up', regime: 'strong_up', label: '强势上涨',
      data_source: 'Yahoo Finance adjusted daily', buy_veto: false,
      decision_use: false,
    });
    expect(result.series).toEqual([expect.objectContaining({ annualized_pct: 126 })]);
  });

  it('keeps the current Yahoo daily bar for the standalone chart and labels it intraday', () => {
    const payload = yahooHistoryEndingToday(Array.from({ length: 230 }, (_, index) => index + 1));
    const dashboard = parseYahooSlopeDashboard('TEST', payload, {
      range: '1y', slopeWindow: 8, maPeriods: [20, 50, 200],
      now: new Date('2026-08-20T15:30:00Z'),
    });
    const decisionSlope = parseYahooSlopeHistory('TEST', payload, {
      now: new Date('2026-08-20T15:30:00Z'),
    });

    expect(dashboard).toMatchObject({
      as_of: '2026-08-20',
      dashboard: {
        latest_bar_status: 'intraday',
        latest_closed_as_of: '2026-08-19',
        channel_alert: { as_of: '2026-08-19', complete_close: true },
      },
    });
    expect(dashboard.dashboard.series.at(-1)).toMatchObject({
      date: '2026-08-20', is_partial: true,
    });
    expect(dashboard.dashboard.series.at(-2)).toMatchObject({
      date: '2026-08-19', is_partial: false,
    });
    expect(dashboard.reason).toContain('8月20日盘中');
    expect(decisionSlope.as_of).toBe('2026-08-19');
  });

  it('returns an honest insufficient-data result instead of inventing a slope', () => {
    const result = parseYahooSlopeHistory(
      'NEW', yahooHistory(Array(219).fill(100)),
      { now: new Date('2026-08-20T12:00:00Z') },
    );

    expect(result.available).toBe(false);
    expect(result.required_bars).toBe(220);
    expect(result.observed_bars).toBe(219);
    expect(result.reason).toContain('至少需要 220 个已收盘交易日');
  });
});

// 2026-10-16 00:17（美东）打开决策页时，Z-Score 全部变「数据不足」、200DMA「待更新」。
// 这组用例把「刚过美东零点」钉住：最后一根完整日线仍是 10-15，不该因为日期翻页被丢掉。
describe('美东零点刚过的完整收盘日线', () => {
  function overnightPayload() {
    const closes = Array.from({ length: 260 }, (_, index) => 200 + Math.sin(index / 7) * 12 + index * 0.1);
    const payload = yahooHistory(closes);
    const result = payload.chart.result[0];
    // 最后一根日线是 10-15 开盘时间戳；上游的 currentTradingPeriod 已指向 10-16 的交易时段。
    const lastTimestamp = Date.UTC(2026, 9, 15, 13, 30) / 1000;
    result.timestamp = closes.map((_, index) => lastTimestamp - (closes.length - 1 - index) * 86_400);
    Object.assign(result.meta, {
      currentTradingPeriod: {
        regular: {
          start: Date.UTC(2026, 9, 16, 13, 30) / 1000,
          end: Date.UTC(2026, 9, 16, 20, 0) / 1000,
        },
      },
    });
    return payload;
  }

  it('零点后仍以 10-15 作为最新完整收盘，Z-Score 正常给出', () => {
    const midnight = new Date('2026-10-16T04:17:00Z');
    const dashboard = parseYahooSlopeDashboard('NVDA', overnightPayload(), {
      range: '1y', slopeWindow: 8, now: midnight,
    });

    expect(dashboard.available).toBe(true);
    expect(dashboard.as_of).toBe('2026-10-15');
    expect(dashboard.dashboard.latest_closed_as_of).toBe('2026-10-15');
    expect(dashboard.dashboard.latest_bar_status).toBe('closed');
    expect(dashboard.dashboard.channel_alert.available).toBe(true);
    expect(dashboard.dashboard.channel_alert.label).not.toBe('数据不足');
    expect(dashboard.dashboard.series.at(-1)?.is_partial).toBe(false);
  });

  it('零点前后给出同一份结论', () => {
    const before = parseYahooSlopeDashboard('NVDA', overnightPayload(), {
      range: '1y', slopeWindow: 8, now: new Date('2026-10-16T03:31:00Z'),
    });
    const after = parseYahooSlopeDashboard('NVDA', overnightPayload(), {
      range: '1y', slopeWindow: 8, now: new Date('2026-10-16T04:17:00Z'),
    });

    expect(after.dashboard.channel_alert).toEqual(before.dashboard.channel_alert);
    expect(after.dashboard.summary).toEqual(before.dashboard.summary);
  });
});
