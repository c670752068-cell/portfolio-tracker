import { describe, expect, it } from 'vitest';
import { convertFromUsd, formatDisplayMoney } from './displayCurrency';
import type { ExchangeRates } from './types';

const rates: ExchangeRates = {
  USD: 1,
  CNY: 6.7776,
  HKD: 7.8386,
  JPY: 155,
  EUR: 0.92,
  GBP: 0.79,
  updatedAt: '2026-07-15',
  source: 'live',
};

describe('display currency rendering', () => {
  it('converts 100 USD to 677.76 CNY without changing the USD input', () => {
    expect(convertFromUsd(100, 'CNY', rates)).toBeCloseTo(677.76);
    expect(formatDisplayMoney(100, 'CNY', rates)).toBe('¥677.76');
  });

  it('formats JPY with no decimal places', () => {
    expect(formatDisplayMoney(100, 'JPY', rates)).toBe('JP¥15,500');
  });

  it('uses the pound sign for GBP', () => {
    expect(formatDisplayMoney(100, 'GBP', rates)).toBe('£79.00');
  });
});
