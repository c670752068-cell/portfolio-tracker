import { describe, expect, it } from 'vitest';
import { computePeTargetPrice } from './peTargetPrice';

describe('computePeTargetPrice', () => {
  it('derives a lower price from the current and basis PE values', () => {
    expect(computePeTargetPrice(400, 30, 21.6)).toEqual({
      targetPrice: 288,
      gapPct: -28,
    });
  });

  it('derives a higher price from the current and basis PE values', () => {
    expect(computePeTargetPrice(400, 20, 24.8)).toEqual({
      targetPrice: 496,
      gapPct: 24,
    });
  });

  it.each([
    [null, 20, 24.8],
    [400, null, 24.8],
    [400, 20, null],
    [0, 20, 24.8],
    [400, 0, 24.8],
    [400, 20, 0],
  ])('returns null without NaN or Infinity for invalid inputs', (price, currentPe, basisPe) => {
    expect(computePeTargetPrice(price, currentPe, basisPe)).toEqual({
      targetPrice: null,
      gapPct: null,
    });
  });
});
