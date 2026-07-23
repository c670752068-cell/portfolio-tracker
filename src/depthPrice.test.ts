import { describe, expect, it } from 'vitest';
import { buildDepthPriceView } from './depthPrice';

const depth = {
  current_pct: -21.8,
  threshold_pct: -16.24,
};

describe('depth price presentation', () => {
  it('derives the high and threshold price from the same quote price and drawdown snapshot', () => {
    const view = buildDepthPriceView(depth, 384.98);

    expect(view.source).toBe('derived');
    expect(view.currentPrice).toBe(384.98);
    expect(view.highPrice).toBeCloseTo(492.3, 2);
    expect(view.thresholdPrice).toBeCloseTo(412.35, 2);
  });

  it('prefers quant-exported prices over a website quote', () => {
    const view = buildDepthPriceView(depth, 384.98, {
      currentPrice: 380,
      highPrice: 490,
      thresholdPrice: 410,
    });

    expect(view).toEqual({
      currentPrice: 380,
      highPrice: 490,
      thresholdPrice: 410,
      source: 'quant',
    });
  });

  it('protects against a minus-100-percent division by zero', () => {
    const view = buildDepthPriceView({ ...depth, current_pct: -100 }, 10);

    expect(view.source).toBe('derived');
    expect(view.currentPrice).toBe(10);
    expect(view.highPrice).toBeNull();
    expect(view.thresholdPrice).toBeNull();
  });

  it('returns unavailable instead of zero or NaN when neither source has a price', () => {
    expect(buildDepthPriceView(depth, null)).toEqual({
      currentPrice: null,
      highPrice: null,
      thresholdPrice: null,
      source: 'unavailable',
    });
  });
});
