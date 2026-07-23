import { classifyMarketSession } from './market-session.mjs';

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/[$,%\s,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function asIsoTime(unixSeconds) {
  const value = Number(unixSeconds);
  if (!Number.isFinite(value)) return null;
  return new Date(value * 1000).toISOString();
}

function lastAlignedMinute(timestamps, closes) {
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return null;
  const lastIndex = Math.min(timestamps.length, closes.length) - 1;
  for (let index = lastIndex; index >= 0; index -= 1) {
    const price = asNumber(closes[index]);
    const timestamp = Number(timestamps[index]);
    if (price != null && Number.isFinite(timestamp)) {
      return { price, timestamp };
    }
  }
  return null;
}

export function buildYahooChartUrl(symbol) {
  const yahooSymbol = symbol.replace('.', '-');
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=5m&includePrePost=true`;
}

export function parseYahooChartQuote(symbol, data) {
  const result = data?.chart?.result?.[0];
  const meta = result?.meta || {};
  const minute = lastAlignedMinute(
    result?.timestamp,
    result?.indicators?.quote?.[0]?.close,
  );
  const regularMarketPrice = asNumber(meta.regularMarketPrice);
  const price = minute?.price ?? regularMarketPrice;
  if (price == null) throw new Error('Yahoo 未返回有效价格');

  const priceTime = minute
    ? asIsoTime(minute.timestamp)
    : asIsoTime(meta.regularMarketTime);
  const session = minute && priceTime
    ? classifyMarketSession(new Date(priceTime), {
        currentTradingPeriod: meta.currentTradingPeriod,
        hasMinuteSeries: true,
      })
    : 'closed';
  const previousClose = asNumber(meta.chartPreviousClose);
  const change = previousClose == null ? null : price - previousClose;

  return {
    symbol,
    price,
    previousClose,
    change,
    changePercent: previousClose ? change / previousClose : null,
    currency: meta.currency || 'USD',
    timestamp: priceTime,
    session,
    priceTime,
    regularMarketPrice,
    source: 'proxy',
    isRealtime: Boolean(minute),
  };
}
