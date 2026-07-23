import type { Holding, QuoteSnapshot } from './types';

const NEW_YORK_TIME_ZONE = 'America/New_York';

const SESSION_LABELS: Record<string, string> = {
  pre: '盘前',
  premarket: '盘前',
  regular: '盘中',
  post: '盘后',
  afterhours: '盘后',
  overnight: '夜盘',
};

function normalizedSession(value: unknown): string {
  if (value === 'premarket') return 'pre';
  if (value === 'afterhours') return 'post';
  return typeof value === 'string' ? value : '';
}

function etTime(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: NEW_YORK_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

export function priceSessionLabel(value: unknown): string {
  return SESSION_LABELS[normalizedSession(value)] || '';
}

export function formatPriceSession(
  session: unknown,
  priceTime: string | null | undefined,
): string {
  const label = priceSessionLabel(session);
  if (!label) return '';
  const time = etTime(priceTime);
  return time ? `${label} ${time} ET` : label;
}

export function quoteSessionMismatchText(
  quantSession: unknown,
  quote: Pick<QuoteSnapshot, 'session' | 'priceTime'> | null,
): string {
  const quant = normalizedSession(quantSession);
  const current = normalizedSession(quote?.session);
  if (!quant || !current || quant === current) return '';
  const quantLabel = priceSessionLabel(quant);
  const currentLabel = priceSessionLabel(current);
  if (!quantLabel || !currentLabel) return '';
  return `量化快照取价为${quantLabel}，当前行情为${currentLabel}；回撤百分比基于量化取价计算。`;
}

export function quoteSyncSessionText(holdings: readonly Holding[]): string {
  const quotes = holdings
    .map((holding) => holding.quote)
    .filter((quote): quote is QuoteSnapshot => Boolean(quote?.session));
  if (quotes.length === 0) return '';
  const latest = quotes.reduce((current, quote) => {
    const currentTime = Date.parse(current.priceTime || current.timestamp || '');
    const quoteTime = Date.parse(quote.priceTime || quote.timestamp || '');
    return Number.isFinite(quoteTime) && (!Number.isFinite(currentTime) || quoteTime > currentTime)
      ? quote
      : current;
  });
  const session = formatPriceSession(latest.session, latest.priceTime || latest.timestamp);
  return session ? `行情时段：${session}` : '';
}
