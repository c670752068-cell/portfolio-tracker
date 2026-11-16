import { describe, expect, it } from 'vitest';
import {
  buySignal, latestQuoteTime, lowerBandGap, parseVolatility, pickVolatilityItem, pointBuyState, reachedBuyLine,
  volatilityBuyLine, vxsmhZone,
} from './volatilityIndex';

const body = {
  volatility: {
    time: '2026-11-05T21:30:00.000Z',
    items: [
      {
        key: 'VXSMH', name: '半导体', symbol: '^VXSMH', price: 65.89, change_percent: 43.8,
        quote_time: '2026-11-05T21:02:02.000Z',
        series: [{ date: '2026-11-04', close: 45.82 }, { date: '', close: 1 }, { date: '2026-11-05', close: 'x' }],
      },
      { key: 'VIX', name: '标普', symbol: '^VIX', price: null, change_percent: null, quote_time: null, series: 'bad' },
      {
        key: 'VXN', name: '纳指', symbol: '^VXN', price: 38.26, change_percent: 69.3,
        quote_time: '2026-11-05T21:15:01.000Z', series: [],
      },
    ],
  },
};

describe('恐慌指数数据', () => {
  it('解析接口返回，坏的日线点丢掉', () => {
    const parsed = parseVolatility(body);

    expect(parsed.time).toBe('2026-11-05T21:30:00.000Z');
    expect(parsed.items[0]).toMatchObject({ key: 'VXSMH', price: 65.89, changePercent: 43.8, quoteTime: '2026-11-05T21:02:02.000Z' });
    expect(parsed.items[0].series).toEqual([{ date: '2026-11-04', close: 45.82, z: null }]);
    expect(parsed.items[1]).toMatchObject({ price: null, changePercent: null, quoteTime: null, series: [] });
  });

  it('返回坏了给空结构，不让页面炸', () => {
    expect(parseVolatility(null)).toEqual({ time: null, items: [] });
    expect(parseVolatility({ volatility: { items: 'x' } }).items).toEqual([]);
  });

  it('数据时间取三个里最新的', () => {
    expect(latestQuoteTime(parseVolatility(body).items)).toBe('2026-11-05T21:15:01.000Z');
    expect(latestQuoteTime([])).toBeNull();
  });

  it('点哪个看哪个，找不到退回第一个，没有数据是 null', () => {
    const { items } = parseVolatility(body);

    expect(pickVolatilityItem(items, 'VXN')?.key).toBe('VXN');
    expect(pickVolatilityItem(items, 'NOPE')?.key).toBe('VXSMH');
    expect(pickVolatilityItem([], 'VXN')).toBeNull();
  });

  it('VXSMH 分区：低于 40 平稳，55 起高波动，中间平常', () => {
    expect(vxsmhZone(39.99)).toBe('平稳');
    expect(vxsmhZone(40)).toBe('平常');
    expect(vxsmhZone(54.99)).toBe('平常');
    expect(vxsmhZone(55)).toBe('高波动');
    expect(vxsmhZone(null)).toBeNull();
  });

  it('买点线：VIX 25、VXN 30、VXSMH 55，别的代码没有线', () => {
    expect(volatilityBuyLine('VIX')).toBe(25);
    expect(volatilityBuyLine('VXN')).toBe(30);
    expect(volatilityBuyLine('VXSMH')).toBe(55);
    expect(volatilityBuyLine('NOPE')).toBeNull();
  });

  it('到线才算：刚好等于算到，没有现价不算', () => {
    const { items } = parseVolatility(body);
    const vix = items.find((item) => item.key === 'VIX')!;

    expect(reachedBuyLine({ ...vix, price: 25 })).toBe(true);
    expect(reachedBuyLine({ ...vix, price: 24.99 })).toBe(false);
    expect(reachedBuyLine({ ...vix, price: null })).toBe(false);
    expect(reachedBuyLine({ ...vix, key: 'NOPE', price: 99 })).toBe(false);
  });
});

describe('价格优先：恐慌到线还要 ETF 击穿通道下沿才算买点', () => {
  const base = parseVolatility(body).items.find((item) => item.key === 'VXSMH')!;
  const withZ = (price: number | null, zScore: number | null) => ({
    ...base,
    price,
    underlying: { symbol: 'SMH', asOf: '2026-11-05', close: 300, lowerBand: 280, zScore },
  });

  it('解析 ETF 通道和每天的 Z', () => {
    const parsed = parseVolatility({ volatility: { items: [{
      key: 'VXSMH', name: '半导体', symbol: '^VXSMH', price: 60,
      series: [{ date: '2026-06-10', close: 58, z: 1.2 }, { date: '2026-06-11', close: 50 }],
      underlying: { symbol: 'SMH', as_of: '2026-11-05', close: 300, lower_band: 280, z_score: -0.4 },
    }] } });

    expect(parsed.items[0].series).toEqual([
      { date: '2026-06-10', close: 58, z: 1.2 }, { date: '2026-06-11', close: 50, z: null },
    ]);
    expect(parsed.items[0].underlying).toEqual({ symbol: 'SMH', asOf: '2026-11-05', close: 300, lowerBand: 280, zScore: -0.4 });
    expect(parseVolatility(body).items[0].underlying).toBeNull();
  });

  it('四种状态', () => {
    expect(buySignal(withZ(60, -1.6))).toBe('buy');
    expect(buySignal(withZ(60, -1.5))).toBe('buy');
    expect(buySignal(withZ(60, -0.4))).toBe('wait_price');
    expect(buySignal(withZ(40, -1.7))).toBe('wait_fear');
    expect(buySignal(withZ(40, 0.5))).toBe('none');
    expect(buySignal(withZ(60, null))).toBe('unknown');
    expect(buySignal(withZ(40, null))).toBe('none');
  });

  it('离下沿多远', () => {
    expect(lowerBandGap(withZ(60, 0).underlying)).toBeCloseTo(7.14, 2);
    expect(lowerBandGap(null)).toBeNull();
  });

  it('图上打点：6 月那种涨上去的高波动只是灰圈，同一天 ETF 破下沿才是红点', () => {
    expect(pointBuyState({ date: '2026-06-10', close: 62, z: 1.3 }, 55)).toBe('fear_only');
    expect(pointBuyState({ date: '2026-04-07', close: 62, z: -1.9 }, 55)).toBe('buy');
    expect(pointBuyState({ date: '2026-04-07', close: 62 }, 55)).toBe('fear_only');
    expect(pointBuyState({ date: '2026-04-07', close: 50, z: -1.9 }, 55)).toBeNull();
    expect(pointBuyState({ date: '2026-04-07', close: 62, z: -1.9 }, null)).toBeNull();
  });
});
