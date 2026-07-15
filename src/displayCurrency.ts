import type { DisplayCurrency, ExchangeRates } from './types';

const symbols: Record<DisplayCurrency, string> = {
  USD: '$',
  CNY: '¥',
  HKD: 'HK$',
  JPY: 'JP¥',
  EUR: '€',
  GBP: '£',
};

export function convertFromUsd(
  usdAmount: number,
  display: DisplayCurrency,
  rates: ExchangeRates,
): number {
  if (!Number.isFinite(usdAmount)) return 0;
  return usdAmount * rates[display];
}

export function formatDisplayMoney(
  usdAmount: number,
  display: DisplayCurrency,
  rates: ExchangeRates,
): string {
  const converted = convertFromUsd(usdAmount, display, rates);
  const sign = converted < 0 ? '-' : '';
  const digits = display === 'JPY' ? 0 : 2;
  return `${sign}${symbols[display]}${Math.abs(converted).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}
