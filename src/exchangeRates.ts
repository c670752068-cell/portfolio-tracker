import type { Currency, ExchangeRates } from './types';

const CACHE_KEY = 'portfolio-tracker:usd-rates-v1';

const fallbackRates: ExchangeRates = {
  USD: 1,
  CNY: 7.2,
  HKD: 7.8,
  JPY: 155,
  EUR: 0.92,
  GBP: 0.79,
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
      JPY: isPositive(parsed.JPY) ? parsed.JPY : fallbackRates.JPY,
      EUR: isPositive(parsed.EUR) ? parsed.EUR : fallbackRates.EUR,
      GBP: isPositive(parsed.GBP) ? parsed.GBP : fallbackRates.GBP,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      source: 'cache',
    };
  } catch {
    return fallbackRates;
  }
}

export async function fetchLatestExchangeRates(): Promise<ExchangeRates> {
  const response = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY,HKD,JPY,EUR,GBP');
  if (!response.ok) throw new Error(`汇率服务返回 HTTP ${response.status}`);
  const payload = (await response.json()) as { date?: string; rates?: Record<string, number> };
  const cny = payload.rates?.CNY;
  const hkd = payload.rates?.HKD;
  const jpy = payload.rates?.JPY;
  const eur = payload.rates?.EUR;
  const gbp = payload.rates?.GBP;
  if (!isPositive(cny) || !isPositive(hkd) || !isPositive(jpy) || !isPositive(eur) || !isPositive(gbp)) {
    throw new Error('汇率服务未返回完整的 CNY / HKD / JPY / EUR / GBP 数据');
  }
  const rates: ExchangeRates = {
    USD: 1,
    CNY: cny,
    HKD: hkd,
    JPY: jpy,
    EUR: eur,
    GBP: gbp,
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
