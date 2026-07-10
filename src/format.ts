export function formatMoney(n: number, currency: string = 'USD'): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const symbol = currency === 'CNY' ? '¥' : currency === 'HKD' ? 'HK$' : currency === 'OTHER' ? '¤' : '$';
  return `${sign}${symbol}${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

export function formatSignedPct(n: number): string {
  const v = (n * 100).toFixed(2);
  return n >= 0 ? `+${v}%` : `${v}%`;
}
