import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  formatBuyNotification,
  formatCnnPositionFloorNotification,
  formatEarningsProtectionNotification,
  formatSellNotification,
  formatTqqqEntryNotification,
  formatUnresolvedWatchlistNotification,
  formatValuationNotification,
  formatVixPositionFloorNotification,
} from './notification-copy.mjs';
import { classifyMarketSession, etParts } from './market-session.mjs';
import { saneSellPricePlan, sellPriceReference } from './sell-price-sanity.mjs';

const BEIJING_TIME_ZONE = 'Asia/Shanghai';
const NOTIFICATION_WINDOW_MINUTES = 5;
const NOTIFICATION_SLOTS = [
  { id: 'premarket', minutes: 21 * 60 + 20 },
  { id: 'open', minutes: 22 * 60 },
];

function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function beijingParts(date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function quantNotificationSlot(date) {
  const clock = beijingParts(date);
  if (classifyMarketSession(date, { hasMinuteSeries: true }) === 'closed') return null;
  const slot = NOTIFICATION_SLOTS.find(({ minutes }) => (
    clock.minutes >= minutes && clock.minutes < minutes + NOTIFICATION_WINDOW_MINUTES
  ));
  return slot ? `${clock.date}:${slot.id}` : null;
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function symbolOf(value) {
  return String(value || '').trim().toUpperCase();
}

function snapshotPrice(snapshot, symbol) {
  const family = record(record(snapshot.symbols)[symbol]);
  const marketPrice = record(family.market_price);
  if (marketPrice.available === true) {
    const price = marketPrice.current_price;
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) return price;
  }
  const heldPrice = rows(record(record(record(snapshot.sell).symbols)[symbol]).positions)
    .find((item) => symbolOf(item?.symbol) === symbol)?.current_price;
  if (typeof heldPrice === 'number' && Number.isFinite(heldPrice) && heldPrice > 0) return heldPrice;
  const depth = record(family.depth_window);
  if (/基准/u.test(String(depth.price_note || ''))) return null;
  const candidates = [depth.current_price, family.current_price, family.price];
  return candidates.find((value) => typeof value === 'number' && Number.isFinite(value) && value > 0) ?? null;
}

function earningsProtection(snapshot, symbol, now) {
  const clock = etParts(now);
  if (clock.minutes >= 10 * 60) return null;
  const dates = rows(record(record(record(snapshot.symbols)[symbol]).earnings).dates)
    .map((value) => String(value));
  const today = Date.parse(`${clock.date}T00:00:00Z`);
  const earningsDate = dates.find((value) => {
    const timestamp = Date.parse(`${value}T00:00:00Z`);
    const ageDays = (today - timestamp) / 86_400_000;
    return Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= 4;
  });
  if (!earningsDate) return null;
  const recent = rows(record(record(record(snapshot.sell).symbols)[symbol]).recent_signals);
  const roseBeforeEarnings = recent.some((item) => (
    String(item?.name || '') === 'pre_earnings_rise'
    && String(item?.date || '') <= earningsDate
  ));
  return roseBeforeEarnings ? null : {
    dateKey: clock.date,
    event: formatEarningsProtectionNotification(
      symbol, snapshotPrice(snapshot, symbol), clock.date,
    ),
  };
}

function buyEvents(snapshot) {
  return rows(record(snapshot.summary).buy_ready).flatMap((item) => {
    const symbol = symbolOf(item?.symbol);
    if (!symbol) return [];
    const reason = `${String(item?.reason || '买入条件已经满足')}${slopeNotificationText(item?.ma_slope)}`;
    const notification = formatBuyNotification(symbol, reason, snapshotPrice(snapshot, symbol));
    return notification ? [notification] : [];
  });
}

function slopeNotificationText(raw) {
  const slope = record(raw);
  const value = slope.annualized_pct;
  if (slope.available !== true || typeof value !== 'number' || !Number.isFinite(value)) {
    return '';
  }
  const label = String(slope.label || '趋势已计算');
  return `；斜率 ${value >= 0 ? '+' : ''}${value.toFixed(2)}%（${label}，仅风险提示）`;
}

function unresolvedWatchlistEvents(snapshot) {
  const unresolved = rows(record(snapshot.growth_watchlist).unresolved)
    .map((item) => symbolOf(item?.symbol))
    .filter(Boolean);
  const notification = formatUnresolvedWatchlistNotification(unresolved);
  return notification ? [notification] : [];
}

function tqqqFirstEntryEvents(snapshot) {
  const entry = record(record(snapshot.summary).tqqq_first_entry);
  const symbol = symbolOf(entry.symbol);
  const benchmark = symbolOf(entry.benchmark) || 'QQQ';
  const drawdownPct = Number(entry.drawdown_pct);
  const thresholdPct = Number(entry.threshold_pct);
  const optionLimitPct = Number(entry.option_position_limit_pct);
  if (
    symbol !== 'TQQQ'
    || !Number.isFinite(drawdownPct)
    || !Number.isFinite(thresholdPct)
    || drawdownPct < thresholdPct
    || !Number.isFinite(optionLimitPct)
    || optionLimitPct <= 0
  ) return [];
  return [formatTqqqEntryNotification({
    benchmark,
    drawdown_pct: drawdownPct,
    threshold_pct: thresholdPct,
    option_position_limit_pct: optionLimitPct,
    cnn_score: Number(record(record(snapshot.context).cnn_fear_greed).score),
    current_price: snapshotPrice(snapshot, symbol),
  })].filter(Boolean);
}

function earningsProtectionEvents(snapshot, now) {
  return rows(record(snapshot.summary).sell_ready).flatMap((item) => {
    const symbol = symbolOf(item?.symbol);
    const protectedEvent = symbol ? earningsProtection(snapshot, symbol, now)?.event : null;
    return protectedEvent ? [protectedEvent] : [];
  });
}

function actionableSellDecisionSymbols(snapshot) {
  return new Set(Object.entries(record(record(snapshot.sell).symbols))
    .filter(([, raw]) => {
      const decision = record(record(raw).decision);
      return decision.verdict === 'SELL' && decision.notification_state === 'sell';
    })
    .map(([symbol]) => symbolOf(symbol))
    .filter(Boolean));
}

// 卖出线离谱时（低于现价一半或高于三倍）不当作有效卖出线，也不拿它触发推送；
// 被丢弃的价格连同输入数据写进服务器日志，便于排查量化侧的估值口径。
function sanePlanFor(snapshot, symbol, raw, logWarning) {
  const plan = record(record(raw).sell_price_plan);
  // 触发价的价格口径跟着 basis：指数方案的触发价是底层指数价（TQQQ 看 QQQ），
  // 个股方案才是自身价；只有方案自己没带价时才退回快照现价。
  return saneSellPricePlan(
    plan,
    sellPriceReference(plan) ?? snapshotPrice(snapshot, symbol),
    (rejected) => logWarning(
      `sell price out of range: ${symbol} ${rejected.field}=${rejected.price}`
      + ` reference=${rejected.reference} method=${rejected.method}`
      + ` basis=${rejected.basis_symbol} forward_pe=${rejected.current_forward_pe}`
      + ` forward_eps=${rejected.implied_forward_eps}`,
    ),
  );
}

function sellDecisionEvents(snapshot, now, logWarning) {
  return Object.entries(record(record(snapshot.sell).symbols)).flatMap(([rawSymbol, raw]) => {
    const symbol = symbolOf(rawSymbol);
    const decision = record(record(raw).decision);
    if (!symbol || decision.verdict !== 'SELL' || decision.notification_state !== 'sell') return [];
    const pricePlan = sanePlanFor(snapshot, symbol, raw, logWarning);
    if (!sellDecisionStillActive(snapshot, symbol, raw, pricePlan)) return [];
    const protectedEvent = earningsProtection(snapshot, symbol, now)?.event;
    if (protectedEvent) return [protectedEvent];
    const history = record(record(decision.evidence).history);
    const notification = formatSellNotification(
      symbol,
      String(decision.reason || '网站卖出条件已满足'),
      '',
      snapshotPrice(snapshot, symbol),
      {
        sell_pct: Number(decision.recommended_sell_pct),
        history_basis: symbolOf(history.basis_symbol),
        target_method: String(pricePlan.method || ''),
        target_price: Number(pricePlan.sell_price),
        trigger_price: Number(pricePlan.trigger_price),
        sell_forward_pe: Number(pricePlan.sell_forward_pe),
        basis_symbol: symbolOf(pricePlan.basis_symbol),
        basis_current_price: Number(pricePlan.basis_current_price),
        current_ttm_pe: Number(pricePlan.current_ttm_pe),
        active_stage: String(pricePlan.active_stage || ''),
        stages: rows(pricePlan.stages),
      },
    );
    return notification ? [notification] : [];
  });
}

function sellDecisionStillActive(snapshot, symbol, raw, plan) {
  const method = String(record(record(raw).sell_price_plan).method || '');
  if (!['forward_pe', 'recovery_valuation'].includes(method)) return true;
  const currentPrice = snapshotPrice(snapshot, symbol);
  if (currentPrice === null) return false;
  // 校验后整份方案已不可用，说明卖出线离谱，不把它当成「已到价」。
  if (String(plan.method || '') === 'unavailable') return false;
  let triggerPrice = Number(plan.trigger_price);
  if (!Number.isFinite(triggerPrice)) triggerPrice = Number(plan.sell_price);
  if (method === 'recovery_valuation' && !Number.isFinite(triggerPrice)) {
    const activeStage = String(plan.active_stage || '');
    const stage = rows(plan.stages).find((item) => String(item?.key || '') === activeStage);
    triggerPrice = Number(stage?.trigger_price);
  }
  return !Number.isFinite(triggerPrice) || currentPrice >= triggerPrice;
}

function portfolioPositionPct(snapshot) {
  const ammo = record(snapshot.ammo_overview);
  const nav = Number(ammo.nav_usd);
  const invested = Number(record(ammo.cash_exposure).invested_usd);
  if (
    !Number.isFinite(nav)
    || nav <= 0
    || !Number.isFinite(invested)
    || invested < 0
  ) return null;
  return invested / nav * 100;
}

function cnnPositionFloorEvents(snapshot) {
  const fear = record(record(snapshot.context).cnn_fear_greed);
  const cnnScore = Number(fear.score);
  const currentPct = portfolioPositionPct(snapshot);
  if (fear.available !== true || !Number.isFinite(cnnScore) || cnnScore > 20 || currentPct === null) return [];
  const notification = formatCnnPositionFloorNotification({
    cnn_score: cnnScore, current_pct: currentPct, target_pct: 60,
  });
  return notification ? [notification] : [];
}

function vixPositionFloorEvents(snapshot) {
  const vixContext = record(record(snapshot.context).vix);
  const vix = Number(vixContext.value);
  const currentPct = portfolioPositionPct(snapshot);
  if (vixContext.available !== true || !Number.isFinite(vix) || vix < 35 || currentPct === null) return [];
  const notification = formatVixPositionFloorNotification({
    vix, current_pct: currentPct, target_pct: vix >= 40 ? 70 : 60,
  });
  return notification ? [notification] : [];
}

// Buy-side valuation encouragement can be sent directly.  Sell-side alerts
// must come from the website's final family decision so PE cannot bypass the
// recovery/high-price rules and contradict the page.
const ACTIONABLE_VALUATION_ZONES = new Set(['extreme_low', 'low']);

function valuationEvents(snapshot, now, excludedSymbols = new Set()) {
  const clock = etParts(now);
  if (classifyMarketSession(now) !== 'pre' || clock.minutes < 8 * 60) return [];
  const valuation = record(snapshot.stock_forward_valuation);
  if (valuation.metric !== 'forward_pe_1bf') return [];
  return Object.entries(record(valuation.symbols)).flatMap(([symbol, item]) => {
    if (excludedSymbols.has(symbolOf(symbol))) return [];
    if (symbolOf(symbol) === 'TSLA') return [];
    if (!ACTIONABLE_VALUATION_ZONES.has(String(record(item).zone || ''))) return [];
    if (['high', 'ultra_high'].includes(String(record(item).zone || ''))) {
      const protectedEvent = earningsProtection(snapshot, symbolOf(symbol), now)?.event;
      if (protectedEvent) return [protectedEvent];
    }
    const notification = formatValuationNotification(symbol, item, snapshotPrice(snapshot, symbolOf(symbol)));
    return notification ? [{ ...notification, key: `${notification.key}:${clock.date}` }] : [];
  });
}

export function buildQuantDecisionEvents(snapshot, { now = new Date(), logWarning = console.warn } = {}) {
  const sellSymbols = actionableSellDecisionSymbols(snapshot);
  const events = [
    ...unresolvedWatchlistEvents(snapshot),
    ...buyEvents(snapshot),
    ...cnnPositionFloorEvents(snapshot),
    ...vixPositionFloorEvents(snapshot),
    ...tqqqFirstEntryEvents(snapshot),
    ...earningsProtectionEvents(snapshot, now),
    ...sellDecisionEvents(snapshot, now, logWarning),
    ...valuationEvents(snapshot, now, sellSymbols),
  ];
  return [...new Map(events.filter(Boolean).map((item) => [item.key, item])).values()];
}

function deliveryIdentity(event) {
  const parts = String(event?.key || '').split(':');
  return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : String(event?.key || 'event');
}

function deliveryKey(event, slot) {
  return `${slot}:${deliveryIdentity(event)}`;
}

async function readState(path) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return Array.isArray(value?.active) ? value : { active: [] };
  } catch {
    return { active: [] };
  }
}

async function writeState(root, state) {
  await mkdir(root, { recursive: true });
  const target = join(root, 'quant-decision-state.json');
  const temporary = join(root, `.quant-decision-${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function deliverQuantDecisionAlerts({ snapshot, alertsRoot, notify, now = new Date(), logError = console.error, notificationSlot }) {
  const slot = notificationSlot === undefined ? quantNotificationSlot(now) : notificationSlot;
  if (!slot) return { events: [], delivered: [], skipped: true };
  const events = buildQuantDecisionEvents(snapshot, { now, logWarning: logError });
  const previous = await readState(join(alertsRoot, 'quant-decision-state.json'));
  const previousKeys = new Set(previous.active);
  const processedSlots = new Set(Array.isArray(previous.processed_slots) ? previous.processed_slots : []);
  if (processedSlots.has(slot)) return { events: [], delivered: [], skipped: true };
  const active = [];
  const delivered = [];
  for (const event of events) {
    const key = deliveryKey(event, slot);
    if (previousKeys.has(key)) {
      active.push(key);
      continue;
    }
    try {
      if (await notify(event) !== false) {
        delivered.push(event);
        active.push(key);
      }
    } catch (error) {
      logError(`quant decision notification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  processedSlots.add(slot);
  const retainedSlots = [...processedSlots].slice(-200);
  await writeState(alertsRoot, {
    updated_at: now.toISOString(), active, processed_slots: retainedSlots,
  });
  return { events, delivered, skipped: false, slot };
}
