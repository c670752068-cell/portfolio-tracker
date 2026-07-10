import type { Currency, ExchangeRates } from './types';

const CACHE_KEY = 'portfolio-tracker:usd-rates-v1';

const fallbackRates: ExchangeRates = {
  USD: 1,
  CNY: 7.2,
  HKD: 7.8,
  updatedAt: null,
  source: 'fallback',
};

export function loadExchangeRates(): ExchangeRates {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return fallbackRates;
    const parsed = JSON.parse(raw) as Partial<ExchangeRates>;
    if (!isPositive(parsed.CNY) || !isPositive(parsed.HKD)) return fallbackRates;
    return {
      USD: 1,
      CNY: parsed.CNY,
      HKD: parsed.HKD,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      source: 'cache',
    };
  } catch {
    return fallbackRates;
  }
}

export async function fetchLatestExchangeRates(): Promise<ExchangeRates> {
  const response = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY,HKD');
  if (!response.ok) throw new Error(`汇率服务返回 HTTP ${response.status}`);
  const payload = (await response.json()) as { date?: string; rates?: Record<string, number> };
  const cny = payload.rates?.CNY;
  const hkd = payload.rates?.HKD;
  if (!isPositive(cny) || !isPositive(hkd)) throw new Error('汇率服务未返回完整的 CNY / HKD 数据');
  const rates: ExchangeRates = {
    USD: 1,
    CNY: cny,
    HKD: hkd,
    updatedAt: payload.date ?? new Date().toISOString().slice(0, 10),
    source: 'live',
  };
  localStorage.setItem(CACHE_KEY, JSON.stringify(rates));
  return rates;
}

export function toUsd(amount: number, currency: Currency, rates: ExchangeRates): number | null {
  if (!Number.isFinite(amount)) return 0;
  if (currency === 'OTHER') return null;
  const rate = rates[currency];
  return rate > 0 ? amount / rate : null;
}

export function isSupportedCurrency(currency: Currency): boolean {
  return currency !== 'OTHER';
}

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
