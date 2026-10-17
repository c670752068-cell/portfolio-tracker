// 用最新收盘价（或盘中价）重算持仓市值。
// 为什么要这个：IBKR 的对账数据晚一个交易日，网站的总资产、持仓市值和杠杆预算
// 就一直显示前一个交易日的数字；周五 AVL 跌 7.8% 这种事反映不进去。
// 这里只改「数值来源」，不改任何阈值，也不碰券商自己的 as_of——
// 那个日期是净值序列和数据新鲜度在用的，必须留着。
// 期权没有免费实时价，一律不重算；重算不了的保持券商原值。

// 我们取到这份报价有多久了，超过就不用（休市时段轮询间隔是 15 分钟）。
// 注意看的是「取数时间」而不是「行情时间」：休市日拿到的就是上一个交易日的
// 收盘价，行情时间是十几个小时前，但那正是我们要的最新收盘价。
export const ESTIMATE_MAX_AGE_MS = 30 * 60 * 1000;
// 新价离券商口径太远就不用：价格一天不可能跌一半或翻倍，
// 这种数据更可能是取错了标的或者行情源出错。
export const ESTIMATE_MIN_RATIO = 0.5;
export const ESTIMATE_MAX_RATIO = 2;

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function finite(value) {
  // Number(null) 是 0：不挡掉就会把「没有价格」算成 0 元市值
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function instant(raw) {
  const parsed = typeof raw === 'string' ? Date.parse(raw) : finite(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

// 取数时间：判断报价新不新鲜用它。没带就退回行情时间（宁可算不出来，
// 也不拿来历不明的价去改总资产）。
function fetchedAt(quote) {
  return instant(record(quote).fetchedAt) ?? instant(record(quote).priceTime) ?? instant(record(quote).timestamp);
}

// 行情时间：写进 price_as_of，告诉人这是哪一刻的价。
function priceAt(quote) {
  return instant(record(quote).priceTime) ?? instant(record(quote).timestamp) ?? instant(record(quote).fetchedAt);
}

/**
 * 返回一份市值按最新价重算过的 payload；一个都算不了时原样返回原对象。
 * net_liquidation 同步加上市值变化量，所以「净值 − 持仓市值」推算出的现金不变。
 */
export function estimatePositionValues(payload, quotes, { now = new Date(), maxAgeMs = ESTIMATE_MAX_AGE_MS } = {}) {
  const source = record(payload);
  const rows = Array.isArray(source.positions) ? source.positions : null;
  const netLiquidation = finite(source.net_liquidation);
  if (!rows || netLiquidation === null) return payload;

  const priced = [];
  const skipped = [];
  let delta = 0;
  let latestPriceAt = null;
  let latestFetchedAt = null;

  const positions = rows.map((row) => {
    const item = record(row);
    const symbol = String(item.symbol || '').toUpperCase();
    const quantity = finite(item.qty);
    const marketValue = finite(item.market_value);
    if (!symbol) return row;
    if (item.asset_type === 'option' || quantity === null || quantity === 0 || marketValue === null) {
      skipped.push(symbol);
      return row;
    }
    const quote = quotes?.[symbol];
    const price = finite(record(quote).price);
    const fetched = fetchedAt(quote);
    if (price === null || price <= 0 || fetched === null || +now - fetched > maxAgeMs) {
      skipped.push(symbol);
      return row;
    }
    const brokerPrice = marketValue / quantity;
    if (brokerPrice <= 0 || price < brokerPrice * ESTIMATE_MIN_RATIO || price > brokerPrice * ESTIMATE_MAX_RATIO) {
      skipped.push(symbol);
      return row;
    }
    const nextValue = price * quantity;
    const at = priceAt(quote);
    delta += nextValue - marketValue;
    priced.push(symbol);
    if (at !== null && (latestPriceAt === null || at > latestPriceAt)) latestPriceAt = at;
    if (latestFetchedAt === null || fetched > latestFetchedAt) latestFetchedAt = fetched;
    return {
      ...item,
      market_value: nextValue,
      market_value_source: 'live_quote',
      broker_market_value: marketValue,
      price_at: at === null ? null : new Date(at).toISOString(),
    };
  });

  if (priced.length === 0) return payload;
  return {
    ...source,
    net_liquidation: netLiquidation + delta,
    broker_net_liquidation: netLiquidation,
    positions,
    estimate: {
      source: 'live_quote',
      price_as_of: latestPriceAt === null ? null : new Date(latestPriceAt).toISOString(),
      fetched_at: new Date(latestFetchedAt).toISOString(),
      broker_as_of: typeof source.as_of === 'string' ? source.as_of : null,
      priced,
      skipped,
    },
  };
}
