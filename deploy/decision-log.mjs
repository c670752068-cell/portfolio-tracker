import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { etCloseInstant, etParts, knownTradingDate } from './market-session.mjs';

// 决策日志：每笔买卖记下「当时的指标」和「用户的预判」，收盘后自动判定结果。
// 成交来自量化快照的 position_ledger.recent_events（前后两次券商快照差分推算），
// 所以买入价由成本增量算出、卖出价常常缺失——缺失的字段一律存空值，绝不补造。
export const DECISION_LOG_FILE = 'decision-log.json';
export const DECISION_LOG_VERSION = 1;
export const TRADE_LIMIT = 2000;
export const NAV_LIMIT = 4000;
export const CASH_FLOW_LIMIT = 500;
const ALLOWED_ORIGINS = ['https://myopenid.top', 'https://www.myopenid.top'];
const TRIGGERS = ['drawdown', 'cnn', 'vix', 'pe_percentile', 'z_score', 'ma200', 'sma', 'sell_line', 'take_profit', 'subjective', 'other'];
const PREDICTION_TYPES = ['rebuy_after_dip', 'target_price', 'beat_qqq', 'take_profit_rule', 'none'];
const STATUSES = ['pending_note', 'in_progress', 'hit', 'miss', 'expired'];

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function numeric(value) {
  // null / undefined / '' 必须保持空值：Number(null) 是 0，会把「卖出价缺失」
  // 写成 $0 的假成交额，也会把缺失的指标写成 0。
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function emptyDecisionLog() {
  return {
    version: DECISION_LOG_VERSION,
    revision: 0,
    updated_at: null,
    // 起算点：这个时刻（含）之前的推算成交不再入账，用于「从空白开始」。
    trades_from: null,
    trades: [],
    nav_series: [],
    cash_flows: [],
  };
}

export function normalizeDecisionLog(value) {
  const store = record(value);
  return {
    version: DECISION_LOG_VERSION,
    revision: numeric(store.revision) ?? 0,
    updated_at: typeof store.updated_at === 'string' ? store.updated_at : null,
    trades_from: typeof store.trades_from === 'string' ? store.trades_from : null,
    trades: rows(store.trades).filter((item) => typeof record(item).id === 'string'),
    nav_series: rows(store.nav_series).filter((item) => typeof record(item).date === 'string'),
    cash_flows: rows(store.cash_flows).filter((item) => typeof record(item).id === 'string'),
  };
}

// 券商清仓后留下的零碎股（NVDA 0.005 股 / $1.08）不是一笔交易：不写决策日志，
// 也不写持仓变化提醒。阈值和持仓页的 src/dustPosition.ts 保持一致。
export const DUST_MARKET_VALUE_USD = 10;
export const DUST_MINIMUM_SHARES = 1;

export function isDustTrade(trade) {
  const item = record(trade);
  // 期权按张数计，1 张不是零碎仓
  if (String(item.asset_type || '') === 'option') return false;
  const qty = numeric(item.qty ?? item.quantity);
  if (qty === null || qty === 0) return false;
  if (Math.abs(qty) < DUST_MINIMUM_SHARES) return true;
  const price = numeric(item.price);
  return price !== null && Math.abs(qty * price) < DUST_MARKET_VALUE_USD;
}

/** 已经记进去的零碎成交只标「已作废」，一行都不删。 */
export function voidDustTrades(store, { reason = '零碎持仓', now = new Date() } = {}) {
  const current = normalizeDecisionLog(store);
  let changed = false;
  const trades = current.trades.map((trade) => {
    if (trade.voided === true || !isDustTrade(trade)) return trade;
    changed = true;
    return { ...trade, voided: true, voided_reason: String(reason), voided_at: now.toISOString() };
  });
  if (!changed) return store;
  return { ...current, trades, revision: current.revision + 1, updated_at: now.toISOString() };
}

export function tradeKey(event) {
  const item = record(event);
  return [
    String(item.broker || '').toUpperCase(),
    String(item.symbol || '').toUpperCase().replace(/^US\./, ''),
    String(item.side || '').toUpperCase(),
    numeric(item.quantity) ?? '',
    String(item.recorded_at || ''),
  ].join('|');
}

// 成交那一刻的指标快照。拿不到就是 null，不猜、不用别的日期的数据顶替。
export function indicatorSnapshot(snapshot, symbol, channelReview) {
  const root = record(snapshot);
  const symbols = record(root.symbols);
  const own = record(symbols[symbol]);
  const qqq = record(record(symbols.QQQ).depth_window);
  const context = record(root.context);
  const valuation = record(record(record(record(root.sell).symbols)[symbol]).decision);
  const evidence = record(record(valuation.evidence).valuation);
  const alert = record(record(record(channelReview).symbols)[symbol]);
  return {
    qqq_drawdown_pct: numeric(qqq.current_pct),
    symbol_drawdown_pct: numeric(record(own.depth_window).current_pct),
    z_score: numeric(alert.z_score),
    z_score_as_of: typeof alert.as_of === 'string' ? alert.as_of : null,
    ma200_slope_pct: numeric(record(own.ma_slope).annualized_pct),
    sma_slope_pct: null,
    ttm_pe: numeric(evidence.current_pe),
    ttm_pe_percentile: numeric(evidence.percentile),
    cnn_fear_greed: numeric(record(context.cnn_fear_greed).score),
    vix: numeric(record(context.vix).value),
    ndx_pe: numeric(record(record(root.valuation_tab).ndx).current_pe),
  };
}

// 券商快照偶尔读空再恢复，差分出来就是「同一刻全部卖掉、几秒后全部买回」。
// 这种同标的、同数量、方向相反且间隔很短的两条是快照伪影，不是真交易，
// 一对一抵消后都不入日志；多出来的那条仍然保留。
export const SNAPSHOT_ARTIFACT_WINDOW_MS = 10 * 60 * 1000;

function artifactPairIndexes(entries, { symbolOf, sideOf, qtyOf, timeOf }) {
  const dropped = new Set();
  const ordered = entries
    .map((entry, index) => ({ index, time: Date.parse(timeOf(entry)) }))
    .filter((item) => Number.isFinite(item.time))
    .sort((left, right) => left.time - right.time);
  for (const item of ordered) {
    if (dropped.has(item.index)) continue;
    const entry = entries[item.index];
    const match = ordered.find((candidate) => (
      candidate.index !== item.index
      && !dropped.has(candidate.index)
      && Math.abs(candidate.time - item.time) <= SNAPSHOT_ARTIFACT_WINDOW_MS
      && symbolOf(entries[candidate.index]) === symbolOf(entry)
      && qtyOf(entries[candidate.index]) === qtyOf(entry)
      && sideOf(entries[candidate.index]) !== sideOf(entry)
    ));
    if (match) {
      dropped.add(item.index);
      dropped.add(match.index);
    }
  }
  return dropped;
}

// 券商整个读空时，同一时间戳上会一次性差分出一大批「整仓卖出」，而且全都
// 没有成交价；恢复后又全部买回。这一整批连同对应的买回都不是真交易。
export const READ_EMPTY_MIN_SYMBOLS = 5;

function readEmptyBatchIndexes(entries, { symbolOf, sideOf, qtyOf, timeOf, priceOf }) {
  const dropped = new Set();
  const groups = new Map();
  entries.forEach((entry, index) => {
    if (sideOf(entry) !== 'SELL') return;
    const key = timeOf(entry);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });
  for (const [, indexes] of groups) {
    const symbols = new Set(indexes.map((index) => symbolOf(entries[index])));
    const everyPriceMissing = indexes.every((index) => priceOf(entries[index]) === null);
    if (symbols.size <= READ_EMPTY_MIN_SYMBOLS || !everyPriceMissing) continue;
    for (const index of indexes) {
      dropped.add(index);
      // 找这一笔对应的买回：同标的、同数量、时间在它之后、最早的一条。
      const sellTime = Date.parse(timeOf(entries[index]));
      const buyBack = entries
        .map((entry, position) => ({ entry, position, time: Date.parse(timeOf(entry)) }))
        .filter((item) => (
          !dropped.has(item.position)
          && sideOf(item.entry) === 'BUY'
          && symbolOf(item.entry) === symbolOf(entries[index])
          && qtyOf(item.entry) === qtyOf(entries[index])
          && Number.isFinite(item.time)
          && item.time >= sellTime
        ))
        .sort((left, right) => left.time - right.time)[0];
      if (buyBack) dropped.add(buyBack.position);
    }
  }
  return dropped;
}

function withoutSnapshotArtifacts(events) {
  const accessors = {
    symbolOf: (event) => String(record(event).symbol || '').toUpperCase().replace(/^US\./, ''),
    sideOf: (event) => String(record(event).side || '').toUpperCase(),
    qtyOf: (event) => numeric(record(event).quantity),
    timeOf: (event) => String(record(event).recorded_at || ''),
    priceOf: (event) => numeric(record(event).price),
  };
  const paired = artifactPairIndexes(events, accessors);
  const remaining = events.filter((_event, index) => !paired.has(index));
  const batched = readEmptyBatchIndexes(remaining, accessors);
  return remaining.filter((_event, index) => !batched.has(index));
}

/** 清掉已经存进去的伪影。只动自动抓来、还没填过理由的那些。 */
export function dropStoredSnapshotArtifacts(store, now = new Date()) {
  const current = normalizeDecisionLog(store);
  const candidates = current.trades
    .map((trade, index) => ({ trade, index }))
    .filter(({ trade }) => (
      trade.recorded_by === 'position_ledger'
      && trade.status === 'pending_note'
      && (trade.trigger || []).length === 0
      && !trade.prediction
      && !trade.note
    ));
  const accessors = {
    symbolOf: (trade) => String(trade.symbol || '').toUpperCase(),
    sideOf: (trade) => String(trade.side || '').toUpperCase(),
    qtyOf: (trade) => numeric(trade.qty),
    timeOf: (trade) => String(trade.trade_time || ''),
    priceOf: (trade) => numeric(trade.price),
  };
  const trades = candidates.map((item) => item.trade);
  const paired = artifactPairIndexes(trades, accessors);
  const remaining = candidates.filter((_item, index) => !paired.has(index));
  const batched = readEmptyBatchIndexes(remaining.map((item) => item.trade), accessors);
  const dropped = [
    ...[...paired].map((index) => candidates[index].trade.id),
    ...[...batched].map((index) => remaining[index].trade.id),
  ];
  if (dropped.length === 0) return store;
  const removeIds = new Set(dropped);
  return {
    ...current,
    trades: current.trades.filter((trade) => !removeIds.has(trade.id)),
    revision: current.revision + 1,
    updated_at: now.toISOString(),
  };
}

// 成交日期：推算成交的 recorded_at 是「同步时间」，不是成交时间——线上出现过
// 6 笔 IBKR 成交被记在周日 20:06。券商数据自己的对账日（broker_health.as_of）
// 才是那批数据对到的交易日，用它的收盘时刻，并标明是推定的。
export const TRADE_DATE_BASIS = '按对账日推定';

function brokerAsOf(snapshot) {
  const source = record(snapshot).freshness?.broker_health ?? record(snapshot).broker_health;
  const map = new Map();
  for (const raw of rows(source)) {
    const item = record(raw);
    const broker = String(item.broker || '').toUpperCase();
    const asOf = typeof item.as_of === 'string' ? item.as_of : null;
    if (broker && asOf) map.set(broker, asOf);
  }
  return map;
}

/** 成交时间落在非交易日的旧记录：挪到上一个交易日的收盘，原时间留在 trade_time_original。 */
export function repairTradeDates(store, { now = new Date() } = {}) {
  const current = normalizeDecisionLog(store);
  let changed = false;
  const trades = current.trades.map((trade) => {
    if (trade.trade_time_original) return trade;
    const day = etParts(new Date(String(trade.trade_time || ''))).date;
    if (!day || knownTradingDate(day) !== false) return trade;
    let cursor = day;
    for (let step = 0; step < 10; step += 1) {
      const previous = new Date(`${cursor}T12:00:00Z`);
      previous.setUTCDate(previous.getUTCDate() - 1);
      cursor = previous.toISOString().slice(0, 10);
      if (knownTradingDate(cursor) === true) break;
    }
    if (knownTradingDate(cursor) !== true) return trade;
    changed = true;
    return {
      ...trade,
      trade_time: etCloseInstant(cursor),
      trade_time_original: trade.trade_time,
      trade_date_estimated: true,
      trade_date_basis: TRADE_DATE_BASIS,
    };
  });
  if (!changed) return store;
  return { ...current, trades, revision: current.revision + 1, updated_at: now.toISOString() };
}

export function captureTrades(store, snapshot, { now = new Date(), channelReview = null, keepArtifacts = false, keepDust = false } = {}) {
  const current = normalizeDecisionLog(store);
  const asOfByBroker = brokerAsOf(snapshot);
  const allEvents = rows(record(record(snapshot).position_ledger).recent_events);
  const events = keepArtifacts ? allEvents : withoutSnapshotArtifacts(allEvents);
  const known = new Set(current.trades.map((trade) => trade.key));
  const added = [];
  for (const event of events) {
    const item = record(event);
    const symbol = String(item.symbol || '').toUpperCase().replace(/^US\./, '');
    const side = String(item.side || '').toUpperCase();
    const quantity = numeric(item.quantity);
    const recordedAt = typeof item.recorded_at === 'string' ? item.recorded_at : null;
    if (!symbol || !['BUY', 'SELL'].includes(side) || quantity === null || quantity === 0 || !recordedAt) continue;
    // 零碎持仓的残留不是交易：不入账，也就不会再写一条持仓变化提醒。
    if (!keepDust && isDustTrade({ ...item, qty: quantity })) continue;
    // 用户清过一次日志之后，起算点之前的旧成交不再抓回来。
    if (current.trades_from && new Date(recordedAt).toISOString() <= current.trades_from) continue;
    const key = tradeKey(item);
    if (known.has(key)) continue;
    known.add(key);
    const price = numeric(item.price);
    const broker = String(item.broker || '').toUpperCase();
    const asOf = asOfByBroker.get(broker) || null;
    added.push({
      id: `trade-${randomBytes(6).toString('hex')}`,
      key,
      trade_time: asOf ? etCloseInstant(asOf) : recordedAt,
      // 同步时间照实留着，便于追溯
      synced_at: recordedAt,
      trade_date_estimated: Boolean(asOf),
      trade_date_basis: asOf ? TRADE_DATE_BASIS : null,
      recorded_by: 'position_ledger',
      symbol,
      side,
      asset_type: typeof item.asset_type === 'string' ? item.asset_type : null,
      broker: String(item.broker || '').toUpperCase() || null,
      qty: quantity,
      price,
      amount: price === null ? null : price * quantity,
      price_source: typeof item.price_source === 'string' ? item.price_source : null,
      price_estimated: item.estimated === true,
      indicators: indicatorSnapshot(snapshot, symbol, channelReview),
      trigger: [],
      prediction: null,
      note: '',
      status: 'pending_note',
      resolved_at: null,
      resolved_price: null,
      result_pct: null,
      qqq_result_pct: null,
      vs_hold_pct: null,
    });
  }
  if (added.length === 0) return current;
  const trades = [...current.trades, ...added]
    .sort((left, right) => String(left.trade_time).localeCompare(String(right.trade_time)))
    .slice(-TRADE_LIMIT);
  return { ...current, trades, revision: current.revision + 1, updated_at: now.toISOString() };
}

/**
 * 净值记在哪一天：用券商数据自己的 as_of（对账到的那个交易日），不是抓取时间。
 * 真实事故：10-17 抓到的快照里 IBKR 的 as_of 还停在 10-15，按抓取时间记就会
 * 把周四的收盘净值记成周五甚至周六的。
 * 快照没给 as_of 就返回 null——不记，也绝不拿抓取时间猜一个日期。
 */
export function navAsOfDate(snapshot) {
  const freshness = record(record(snapshot).freshness);
  for (const value of [freshness.positions_as_of, freshness.data_as_of]) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  }
  return null;
}

/**
 * as_of 那一天必须是交易日、而且常规时段已经收盘，才把净值记下来。
 * （as_of 等于当天、当天还没收盘时先等着，下一次抓取再记。）
 */
export function navCaptureDate(snapshot, now) {
  const day = navAsOfDate(snapshot);
  if (!day || knownTradingDate(day) === false) return null;
  const close = etCloseInstant(day);
  if (!close) return null;
  return +now >= Date.parse(close) ? day : null;
}

function shiftDay(dateKey, days) {
  const moved = new Date(`${dateKey}T12:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** 上一条和今天之间漏掉的交易日，标「缺失」占位，不拿旧数值顶上。 */
function missingTradingDays(series, day) {
  const last = series.at(-1)?.date;
  if (!last || last >= day) return [];
  const gaps = [];
  for (let cursor = shiftDay(last, 1); cursor < day; cursor = shiftDay(cursor, 1)) {
    if (knownTradingDate(cursor) === false) continue;
    if (series.some((point) => point.date === cursor)) continue;
    gaps.push({ date: cursor, nav: null, missing: true, captured_at: null });
  }
  return gaps;
}

export function captureNav(store, snapshot, { now = new Date(), date = null } = {}) {
  const current = normalizeDecisionLog(store);
  const nav = numeric(record(record(snapshot).ammo_overview).nav_usd);
  const day = date || navCaptureDate(snapshot, now);
  if (nav === null || !day) return current;
  const existing = current.nav_series.findIndex((point) => point.date === day);
  const point = { date: day, nav, missing: false, captured_at: now.toISOString() };
  const gaps = existing >= 0 ? [] : missingTradingDays(current.nav_series, day);
  const nav_series = existing >= 0
    ? current.nav_series.map((item, index) => (index === existing ? point : item))
    : [...current.nav_series, ...gaps, point]
      .sort((left, right) => left.date.localeCompare(right.date)).slice(-NAV_LIMIT);
  if (existing >= 0 && current.nav_series[existing].nav === nav
    && current.nav_series[existing].missing !== true) return current;
  return { ...current, nav_series, revision: current.revision + 1, updated_at: now.toISOString() };
}

export function etDate(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return parts.year ? `${parts.year}-${parts.month}-${parts.day}` : null;
}

export function applyTradeNote(store, id, patch, now = new Date()) {
  const current = normalizeDecisionLog(store);
  const index = current.trades.findIndex((trade) => trade.id === id);
  if (index < 0) throw Object.assign(new Error('找不到这笔交易'), { status: 404 });
  const input = record(patch);
  const trigger = rows(input.trigger).map((item) => String(item)).filter((item) => TRIGGERS.includes(item));
  const prediction = input.prediction === null || input.prediction === undefined
    ? null
    : validatePrediction(input.prediction);
  const note = typeof input.note === 'string' ? input.note.slice(0, 2000) : '';
  const price = numeric(input.price);
  const qty = numeric(input.qty);
  const previous = current.trades[index];
  // 只有「我据此下单了」生成的草稿能补数量；券商抓来的成交数量不许改。
  if (qty !== null && (previous.draft !== true || qty <= 0)) {
    throw Object.assign(new Error('数量只能在草稿上补，且要大于 0'), { status: 400 });
  }
  const nextQty = qty === null ? previous.qty : qty;
  const nextPrice = price === null ? previous.price : price;
  const next = {
    ...previous,
    trigger,
    prediction,
    note,
    qty: nextQty,
    // 推算成交缺卖出价时允许手工补一个，并标明是人工填的。
    price: nextPrice,
    amount: nextPrice === null || nextQty === null ? null : nextPrice * nextQty,
    price_source: price === null ? previous.price_source : 'manual',
    price_estimated: price === null ? previous.price_estimated : false,
    status: prediction === null && trigger.length === 0 && !note ? 'pending_note' : 'in_progress',
    noted_at: now.toISOString(),
  };
  const trades = current.trades.map((trade, position) => (position === index ? next : trade));
  return { ...current, trades, revision: current.revision + 1, updated_at: now.toISOString() };
}

function validatePrediction(value) {
  const input = record(value);
  const type = String(input.type || '');
  if (!PREDICTION_TYPES.includes(type)) throw Object.assign(new Error('预判类型不在允许范围内'), { status: 400 });
  if (type === 'none') return { type };
  const reference = String(input.reference_symbol || '').toUpperCase().replace(/^US\./, '') || null;
  if (type === 'rebuy_after_dip') {
    const dip = numeric(input.dip_pct);
    if (dip === null || dip <= 0 || dip > 90) throw Object.assign(new Error('回调幅度要在 0～90% 之间'), { status: 400 });
    return { type, dip_pct: dip, reference_symbol: reference || 'QQQ' };
  }
  if (type === 'target_price') {
    const target = numeric(input.target_price);
    const months = numeric(input.horizon_months);
    if (target === null || target <= 0) throw Object.assign(new Error('目标价要大于 0'), { status: 400 });
    if (months === null || months <= 0 || months > 60) throw Object.assign(new Error('期限要在 1～60 个月之间'), { status: 400 });
    return { type, target_price: target, horizon_months: months, reference_symbol: reference };
  }
  if (type === 'beat_qqq') {
    const months = numeric(input.horizon_months);
    if (![1, 3, 6, 12].includes(months)) throw Object.assign(new Error('跑赢 QQQ 的期限只支持 1 / 3 / 6 / 12 个月'), { status: 400 });
    return { type, horizon_months: months, reference_symbol: 'QQQ' };
  }
  const trailing = numeric(input.trailing_pct);
  const fixed = numeric(input.fixed_gain_pct);
  if (trailing === null && fixed === null) throw Object.assign(new Error('止盈规则要填移动止盈或固定止盈'), { status: 400 });
  return { type, trailing_pct: trailing, fixed_gain_pct: fixed };
}

// 支持手动补录过去的交易（推算成交只保留最近 50 条，更早的只能自己补）。
export function addManualTrade(store, input, now = new Date()) {
  const current = normalizeDecisionLog(store);
  const item = record(input);
  const symbol = String(item.symbol || '').trim().toUpperCase().replace(/^US\./, '');
  const side = String(item.side || '').toUpperCase();
  const qty = numeric(item.qty);
  const price = numeric(item.price);
  const tradeTime = String(item.trade_time || '');
  // 「我据此下单了」先占一行草稿：数量和价格可以后补，其余照常校验。
  const draft = item.draft === true;
  const alertId = typeof item.alert_id === 'string' ? item.alert_id.slice(0, 64) : null;
  if (!/^[A-Z][A-Z0-9.-]{0,10}$/.test(symbol)) throw Object.assign(new Error('代码格式不正确'), { status: 400 });
  if (!['BUY', 'SELL'].includes(side)) throw Object.assign(new Error('方向只能是买入或卖出'), { status: 400 });
  if (draft ? qty !== null && qty <= 0 : qty === null || qty <= 0) {
    throw Object.assign(new Error('数量要大于 0'), { status: 400 });
  }
  if (Number.isNaN(Date.parse(tradeTime))) throw Object.assign(new Error('成交时间格式不正确'), { status: 400 });
  if (current.trades.length >= TRADE_LIMIT) throw Object.assign(new Error('日志条数已达上限'), { status: 400 });
  const trade = {
    id: `trade-${randomBytes(6).toString('hex')}`,
    key: draft ? `MANUAL|${symbol}|${side}|draft|${alertId || tradeTime}` : `MANUAL|${symbol}|${side}|${qty}|${tradeTime}`,
    trade_time: new Date(tradeTime).toISOString(),
    recorded_by: 'manual',
    symbol,
    side,
    asset_type: null,
    broker: null,
    qty,
    price,
    amount: price === null || qty === null ? null : price * qty,
    price_source: price === null ? null : 'manual',
    price_estimated: false,
    // 补录的交易没有当时的指标快照，留空不补造。
    indicators: indicatorSnapshot(null, symbol, null),
    trigger: [],
    prediction: null,
    note: typeof item.note === 'string' ? item.note.slice(0, 2000) : '',
    // 草稿是哪条提醒带来的：只存 id 和原文，方便在决策日志里回看
    draft,
    alert_id: alertId,
    alert_text: typeof item.alert_text === 'string' ? item.alert_text.slice(0, 500) : null,
    status: 'pending_note',
    resolved_at: null,
    resolved_price: null,
    result_pct: null,
    qqq_result_pct: null,
    vs_hold_pct: null,
  };
  if (current.trades.some((existing) => existing.key === trade.key)) {
    throw Object.assign(new Error('这笔交易已经记过了'), { status: 400 });
  }
  const trades = [...current.trades, trade].sort((left, right) => String(left.trade_time).localeCompare(String(right.trade_time)));
  return { ...current, trades, revision: current.revision + 1, updated_at: now.toISOString() };
}

export function applyCashFlow(store, input, now = new Date()) {
  const current = normalizeDecisionLog(store);
  const item = record(input);
  const amount = numeric(item.amount);
  const date = String(item.date || '');
  if (amount === null || amount === 0) throw Object.assign(new Error('出入金金额要是非零数字'), { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Object.assign(new Error('出入金日期格式应为 YYYY-MM-DD'), { status: 400 });
  if (current.cash_flows.length >= CASH_FLOW_LIMIT) throw Object.assign(new Error('出入金记录过多'), { status: 400 });
  const flow = {
    id: `flow-${randomBytes(6).toString('hex')}`,
    date,
    amount,
    note: typeof item.note === 'string' ? item.note.slice(0, 200) : '',
    created_at: now.toISOString(),
  };
  const cash_flows = [...current.cash_flows, flow].sort((left, right) => left.date.localeCompare(right.date));
  return { ...current, cash_flows, revision: current.revision + 1, updated_at: now.toISOString() };
}

export function removeCashFlow(store, id, now = new Date()) {
  const current = normalizeDecisionLog(store);
  const cash_flows = current.cash_flows.filter((flow) => flow.id !== id);
  if (cash_flows.length === current.cash_flows.length) throw Object.assign(new Error('找不到这条出入金'), { status: 404 });
  return { ...current, cash_flows, revision: current.revision + 1, updated_at: now.toISOString() };
}

/** 清空交易记录并把起算点定在最后一笔成交上；净值和出入金不动。 */
export function clearTrades(store, now = new Date()) {
  const current = normalizeDecisionLog(store);
  if (current.trades.length === 0) return store;
  const latest = current.trades
    .map((trade) => Date.parse(String(trade.trade_time || '')))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left)[0];
  return {
    ...current,
    trades: [],
    trades_from: new Date(Number.isFinite(latest) ? latest : +now).toISOString(),
    revision: current.revision + 1,
    updated_at: now.toISOString(),
  };
}

export async function readDecisionLog(root) {
  try {
    return normalizeDecisionLog(JSON.parse(await readFile(join(root, DECISION_LOG_FILE), 'utf8')));
  } catch {
    return emptyDecisionLog();
  }
}

export async function writeDecisionLog(root, store) {
  await mkdir(root, { recursive: true });
  const target = join(root, DECISION_LOG_FILE);
  const temporary = join(root, `.${DECISION_LOG_FILE}-${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function sameSiteWrite(req, { requireJson = true } = {}) {
  // 用户明确不要密码登录。同源 + 自定义头只能挡住跨站表单，不是身份认证。
  const origin = req.headers.origin;
  let sameOrigin = !origin;
  if (origin) {
    try {
      sameOrigin = new URL(origin).host === req.headers.host || ALLOWED_ORIGINS.includes(origin);
    } catch {
      sameOrigin = false;
    }
  }
  if (!sameOrigin || req.headers['x-decision-log'] !== '1') return false;
  // DELETE 没有请求体，不要求 content-type。
  return !requireJson || String(req.headers['content-type'] || '').startsWith('application/json');
}

/** 只读展示 + 用户自己补笔记的接口。没有密码（用户要求），写入只做同源校验。 */
export function createDecisionLogRoute({ root, sendJson, readBody, now = () => new Date() }) {
  let queue = Promise.resolve();
  const serial = (task) => {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
  };
  const deny = (res) => sendJson(res, 403, { error: { code: 'forbidden', message: '请从本网站的日志页面修改' } });

  async function mutate(res, req, change, { requireJson = true, url = null } = {}) {
    if (!sameSiteWrite(req, { requireJson })) { deny(res); return; }
    let input = {};
    if (!requireJson && url) {
      // DELETE 没有请求体，版本号从查询串里取，并发保护和其他写操作一致。
      const revision = url.searchParams.get('revision');
      if (revision !== null) input = { revision };
    }
    if (requireJson) {
      try {
        input = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      } catch {
        sendJson(res, 400, { error: { code: 'invalid_json', message: '请求体不是合法 JSON' } });
        return;
      }
    }
    await serial(async () => {
      const current = await readDecisionLog(root);
      const expected = Number(record(input).revision);
      if (Number.isFinite(expected) && expected !== current.revision) {
        sendJson(res, 409, { error: { code: 'revision_conflict', message: '日志已在别处修改，请刷新后重试' }, log: current });
        return;
      }
      try {
        const next = change(current, input, now());
        await writeDecisionLog(root, next);
        sendJson(res, 200, { log: next });
      } catch (error) {
        sendJson(res, error?.status || 400, { error: { code: 'invalid_request', message: error?.message || '请求无效' } });
      }
    });
  }

  return async function handleDecisionLogRoute(url, req, res) {
    if (!url.pathname.startsWith('/api/portfolio/decision-log')) return false;
    if (url.pathname === '/api/portfolio/decision-log' && req.method === 'GET') {
      sendJson(res, 200, { log: await readDecisionLog(root) });
      return true;
    }
    const tradeMatch = url.pathname.match(/^\/api\/portfolio\/decision-log\/trades\/([A-Za-z0-9_-]{1,64})$/);
    if (tradeMatch && req.method === 'PUT') {
      await mutate(res, req, (store, input, at) => applyTradeNote(store, tradeMatch[1], input, at));
      return true;
    }
    if (url.pathname === '/api/portfolio/decision-log/trades' && req.method === 'POST') {
      await mutate(res, req, (store, input, at) => addManualTrade(store, input, at));
      return true;
    }
    if (url.pathname === '/api/portfolio/decision-log/cash-flows' && req.method === 'POST') {
      await mutate(res, req, (store, input, at) => applyCashFlow(store, input, at));
      return true;
    }
    const flowMatch = url.pathname.match(/^\/api\/portfolio\/decision-log\/cash-flows\/([A-Za-z0-9_-]{1,64})$/);
    if (flowMatch && req.method === 'DELETE') {
      await mutate(res, req, (store, _input, at) => removeCashFlow(store, flowMatch[1], at), { requireJson: false, url });
      return true;
    }
    sendJson(res, 404, { error: { code: 'not_found', message: '未知接口' } });
    return true;
  };
}
