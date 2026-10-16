// 预判结果的自动判定。规则按用户定下的来，一条都不自己发明：
// · 卖出后等回调 X%：前高 = max(卖出前 52 周最高收盘, 卖出后出现过的最高收盘)；
//   参考标的（默认 QQQ）收盘价第一次 ≤ 前高 ×(1−X) 的那天为接回日，接回价取
//   该标的自己当天的收盘价；接回价 < 卖出价算命中。超过 365 天未触发算过期。
// · 目标价：期限内收盘摸到算命中，到期没摸到算未命中。
// · 跑赢 QQQ：期满时自己的涨幅 > QQQ 同期涨幅算命中。
// · 止盈规则：只记卖出后 20 / 60 个交易日的走势，不计入命中率。
export const RESOLVE_EXPIRY_DAYS = 365;
const LOOKBACK_52_WEEKS_DAYS = 364;

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function sortedCloses(series) {
  return rows(series)
    .filter((point) => typeof point?.date === 'string' && positive(point.close) !== null)
    .map((point) => ({ date: point.date, close: Number(point.close) }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function shiftDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function addMonths(date, months) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 10);
}

function tradeDate(trade) {
  const parsed = new Date(String(trade?.trade_time || ''));
  return Number.isNaN(+parsed) ? null : parsed.toISOString().slice(0, 10);
}

function pct(from, to) {
  return (to / from - 1) * 100;
}

function resolveRebuyAfterDip(trade, tradeDay, own, reference, today) {
  const dip = positive(trade.prediction.dip_pct);
  if (dip === null) return null;
  const sellPrice = positive(trade.price);
  if (sellPrice === null || reference.length === 0 || own.length === 0) return null;

  const priorWindow = reference.filter((point) => point.date >= shiftDays(tradeDay, -LOOKBACK_52_WEEKS_DAYS) && point.date <= tradeDay);
  const after = reference.filter((point) => point.date > tradeDay);
  if (after.length === 0) return null;

  let high = Math.max(...priorWindow.map((point) => point.close), 0);
  for (const point of after) {
    high = Math.max(high, point.close);
    if (high > 0 && point.close <= high * (1 - dip / 100)) {
      const ownPoint = own.find((item) => item.date === point.date)
        ?? [...own].reverse().find((item) => item.date <= point.date);
      const rebuyPrice = positive(ownPoint?.close);
      if (rebuyPrice === null) return null;
      return {
        status: rebuyPrice < sellPrice ? 'hit' : 'miss',
        resolved_at: point.date,
        resolved_price: rebuyPrice,
        result_pct: pct(sellPrice, rebuyPrice),
        vs_hold_pct: (sellPrice - rebuyPrice) / sellPrice * 100,
      };
    }
  }

  if (today < shiftDays(tradeDay, RESOLVE_EXPIRY_DAYS)) return null;
  const last = own[own.length - 1];
  const lastPrice = positive(last?.close);
  if (lastPrice === null) return null;
  return {
    status: 'expired',
    resolved_at: last.date,
    resolved_price: lastPrice,
    result_pct: pct(sellPrice, lastPrice),
    vs_hold_pct: (sellPrice - lastPrice) / sellPrice * 100,
  };
}

function resolveTargetPrice(trade, tradeDay, own, today) {
  const target = positive(trade.prediction.target_price);
  const months = positive(trade.prediction.horizon_months);
  const entry = positive(trade.price);
  if (target === null || months === null || own.length === 0) return null;
  const deadline = addMonths(tradeDay, months);
  const window = own.filter((point) => point.date > tradeDay && point.date <= deadline);
  const reached = window.find((point) => point.close >= target);
  if (reached) {
    return {
      status: 'hit',
      resolved_at: reached.date,
      resolved_price: reached.close,
      result_pct: entry === null ? null : pct(entry, reached.close),
      vs_hold_pct: null,
    };
  }
  if (today <= deadline || window.length === 0) return null;
  const last = window[window.length - 1];
  return {
    status: 'miss',
    resolved_at: last.date,
    resolved_price: last.close,
    result_pct: entry === null ? null : pct(entry, last.close),
    vs_hold_pct: null,
  };
}

function resolveBeatQqq(trade, tradeDay, own, reference, today) {
  const months = positive(trade.prediction.horizon_months);
  if (months === null || own.length === 0 || reference.length === 0) return null;
  const deadline = addMonths(tradeDay, months);
  if (today <= deadline) return null;
  const pick = (series) => {
    const start = series.find((point) => point.date >= tradeDay);
    const end = [...series].reverse().find((point) => point.date <= deadline);
    return start && end && end.date > start.date ? { start, end } : null;
  };
  const ownRange = pick(own);
  const referenceRange = pick(reference);
  if (!ownRange || !referenceRange) return null;
  const ownReturn = pct(ownRange.start.close, ownRange.end.close);
  const referenceReturn = pct(referenceRange.start.close, referenceRange.end.close);
  return {
    status: ownReturn > referenceReturn ? 'hit' : 'miss',
    resolved_at: ownRange.end.date,
    resolved_price: ownRange.end.close,
    result_pct: ownReturn,
    qqq_result_pct: referenceReturn,
    vs_hold_pct: ownReturn - referenceReturn,
  };
}

function resolveTakeProfitRule(trade, tradeDay, own) {
  const sellPrice = positive(trade.price);
  if (sellPrice === null || own.length === 0) return null;
  const after = own.filter((point) => point.date > tradeDay);
  if (after.length === 0) return null;
  const at = (sessions) => {
    const point = after[sessions - 1];
    return point ? pct(sellPrice, point.close) : null;
  };
  const follow = {
    after_20_sessions_pct: at(20),
    after_60_sessions_pct: at(60),
    highest_after_pct: pct(sellPrice, Math.max(...after.map((point) => point.close))),
    lowest_after_pct: pct(sellPrice, Math.min(...after.map((point) => point.close))),
    sessions: after.length,
  };
  if (follow.after_20_sessions_pct === null && follow.after_60_sessions_pct === null) return null;
  return { status: 'in_progress', follow_up: follow };
}

export function resolveTrade(trade, { ownSeries, referenceSeries, today }) {
  if (!trade || trade.status !== 'in_progress') return null;
  const prediction = trade.prediction;
  if (!prediction || prediction.type === 'none') return null;
  if (positive(trade.price) === null) return null;
  const tradeDay = tradeDate(trade);
  if (!tradeDay || !today) return null;
  const own = sortedCloses(ownSeries);
  const reference = sortedCloses(referenceSeries);
  if (prediction.type === 'rebuy_after_dip') return resolveRebuyAfterDip(trade, tradeDay, own, reference, today);
  if (prediction.type === 'target_price') return resolveTargetPrice(trade, tradeDay, own, today);
  if (prediction.type === 'beat_qqq') return resolveBeatQqq(trade, tradeDay, own, reference, today);
  if (prediction.type === 'take_profit_rule') return resolveTakeProfitRule(trade, tradeDay, own);
  return null;
}

export function resolveDecisionLog(store, { seriesFor, today, now = new Date() }) {
  const trades = rows(store?.trades);
  let changed = false;
  const next = trades.map((trade) => {
    const prediction = trade?.prediction;
    const reference = prediction?.reference_symbol || 'QQQ';
    const patch = resolveTrade(trade, {
      ownSeries: seriesFor(trade.symbol),
      referenceSeries: seriesFor(String(reference).toUpperCase()),
      today,
    });
    if (!patch) return trade;
    changed = true;
    return {
      ...trade,
      ...patch,
      resolved_at: patch.status === 'in_progress' ? trade.resolved_at : (patch.resolved_at ?? null),
      qqq_result_pct: patch.qqq_result_pct ?? trade.qqq_result_pct ?? null,
      judged_at: now.toISOString(),
    };
  });
  if (!changed) return store;
  return { ...store, trades: next, revision: Number(store.revision || 0) + 1, updated_at: now.toISOString() };
}

/** 判定需要哪些标的的日线（自己 + 参考标的）。 */
export function resolveSymbols(store) {
  const needed = new Set();
  for (const trade of rows(store?.trades)) {
    if (trade?.status !== 'in_progress' || !trade?.prediction || trade.prediction.type === 'none') continue;
    if (typeof trade.symbol === 'string' && trade.symbol) needed.add(trade.symbol.toUpperCase());
    const reference = trade.prediction.reference_symbol || 'QQQ';
    needed.add(String(reference).toUpperCase());
  }
  return [...needed];
}
