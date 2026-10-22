import { appendAlerts } from './alert-log.mjs';
import { withinCooldown } from './alert-noise.mjs';
import {
  bigMoveAlert, cnnAlerts, cnnTierStates, futuresDropAlerts, intradayZAlerts, nearBreakoutAlerts,
  nearBreakoutStates, negativeStreak, qqqRealtimeAlerts, resonanceAlert, sessionLabel, vixAlerts,
} from './realtime-alerts.mjs';
import { portfolioLossAlerts } from './portfolio-loss.mjs';
import { tradingDate } from './market-session.mjs';
import { pushPlanFor, realtimeDefaults } from './realtime-push.mjs';
import { isSaneSellPrice } from './sell-price-sanity.mjs';

// 一次轮询：拿到的行情 → 该写哪些提醒 → 按开关决定推不推。
// 纯靠入参，没有网络和文件操作，方便测试；网关负责喂数据和落盘。
export const MONITOR_SYMBOL_LIMIT = 24;

export function monitorSymbols({ held = [], decision = [] } = {}) {
  const list = ['QQQ', 'VIX', ...held, ...decision]
    .map((symbol) => String(symbol || '').trim().toUpperCase())
    .filter(Boolean);
  return [...new Set(list)].slice(0, MONITOR_SYMBOL_LIMIT);
}

function finite(value) {
  // Number(null) 是 0：不挡掉就会把「没有数」算成 0
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function runRealtimeTick({
  now = new Date(),
  session = 'closed',
  store,
  quotes = {},
  intradayZ = {},
  sellLines = {},
  heldSymbols = [],
  qqqPreviousHigh = null,
  qqqPeakDate = null,
  cnnScore = null,
  previousCnnScore = null,
  cnnFloorReported = false,
  settings = realtimeDefaults(),
  dispatch = async () => ({ status: 'skipped' }),
  quiet = false,
  dryRun = false,
  confirmation = false,
  // 同一标的、同一类提醒的冷却时间；0 表示不限制。重要提醒和真的推出去的那条不受限。
  cooldownMs = 0,
  // 「大涨大跌」的阈值配置（杠杆 ETF 按倍数放大），来自配置文件。
  bigMove = {},
  // 接近露头的读数：{ 标的: { streak, currentZ, previousZ, price } }
  nearBreakout = {},
  // 三大指数/期货的当前读数，用来判「期货大跌」
  indexItems = [],
  // 持仓今日预估盈亏，用来判「持仓整体浮亏」
  portfolioLoss = null,
}) {
  // 去重用「美东交易日」，不是日历日期：周六重新开一天，不该把周五记过的再记一遍。
  const day = tradingDate(now);
  // 休市日（周末、美股节假日）没有新的交易时段，涨跌类提醒一律不产生，
  // 只保留 CNN 这种和交易时段无关的低频检查。
  const hasTradingSession = session !== 'closed';
  const firedKeys = new Set((store?.alerts || []).map((item) => item.dedupe_key));
  const held = new Set(heldSymbols.map((symbol) => String(symbol).toUpperCase()));
  const alerts = [];

  const qqq = quotes.QQQ;
  if (hasTradingSession && qqq && qqqPreviousHigh && qqqPeakDate) {
    alerts.push(...qqqRealtimeAlerts({
      price: qqq.price, previousHigh: qqqPreviousHigh, session, firedKeys, peakDate: qqqPeakDate, confirmation,
    }));
  }
  const vix = quotes.VIX;
  if (hasTradingSession && vix) {
    alerts.push(...vixAlerts({
      price: vix.price, previousClose: vix.previousClose, dayHigh: vix.dayHigh ?? null, session, firedKeys, day,
    }));
  }
  const tierStates = store?.states || {};
  if (cnnScore !== null && cnnScore !== undefined) {
    alerts.push(...cnnAlerts({
      score: cnnScore, previousScore: previousCnnScore, firedKeys, day,
      floorReported: cnnFloorReported, tierStates,
    }));
  }
  // 盘中 Z：常规时段用未收盘那根；夜盘日线不更新，用现价估算（网关那边给读数）。
  // 盘前/盘后仍然不判定——那两个时段缓存里的「未收盘那根」是上一个交易日的，
  // 会把昨天的穿越重放一遍。
  const zSessions = session === 'regular' || session === 'overnight';
  for (const [symbol, reading] of (zSessions ? Object.entries(intradayZ) : [])) {
    alerts.push(...intradayZAlerts({
      symbol, price: reading?.price, previousZ: reading?.previousZ, currentZ: reading?.currentZ,
      session, firedKeys, day,
    }));
  }
  // 接近露头：和盘中 Z 一样，只在日线缓存靠得住的时段判定（常规时段看未收盘那根，
  // 盘后看刚收盘那根）。同一轮只提醒一次，Z 跌回 -0.5 以下才重置。
  let breakoutStates = store?.states || {};
  for (const [symbol, reading] of Object.entries(nearBreakout)) {
    const found = nearBreakoutAlerts({
      symbol, price: reading?.price, previousZ: reading?.previousZ, currentZ: reading?.currentZ,
      streak: Number(reading?.streak) || 0, session, states: breakoutStates, day,
      confirmation: session === 'post',
    });
    alerts.push(...found);
    breakoutStates = nearBreakoutStates(breakoutStates, {
      symbol, currentZ: reading?.currentZ, fired: found.length > 0,
    });
  }

  for (const [symbol, quote] of (hasTradingSession ? Object.entries(quotes) : [])) {
    if (symbol === 'VIX') continue;
    const move = bigMoveAlert({
      symbol, price: quote?.price, changePercent: quote?.changePercent,
      held: held.has(symbol), session, firedKeys, day, bigMove,
    });
    if (move) alerts.push(move);
  }
  for (const [symbol, line] of (hasTradingSession ? Object.entries(sellLines) : [])) {
    const quote = quotes[symbol];
    const trigger = finite(line?.trigger);
    const price = finite(quote?.price);
    if (trigger === null || price === null || price < trigger) continue;
    // 和卖出页同一套校验：卖出线必须和基准价同一个数量级，没有基准价就不提醒。
    // 真实事故：TSLA 现价 $353 时拿 $31.41 当卖出线写了一行「已到卖出线」。
    if (!isSaneSellPrice(trigger, finite(line?.reference))) continue;
    const key = `sell-line-live:${symbol}:${trigger}:${day}`;
    if (firedKeys.has(key)) continue;
    alerts.push({
      kind: 'sell_line', dedupe_key: key, category: 'sell_line', symbol, icon: '💰', level: 'important',
      value: price, threshold: trigger, session,
      text: `[${sessionLabel(session)}] ${symbol} $${price.toFixed(2)} ≥ 卖出线 $${trigger.toFixed(2)}${line?.label ? ` · ${line.label}` : ''}`,
    });
  }
  if (hasTradingSession && qqq && qqqPreviousHigh) {
    const drawdown = (Number(qqq.price) / qqqPreviousHigh - 1) * 100;
    const vixChange = vix && vix.previousClose ? (Number(vix.price) / Number(vix.previousClose) - 1) * 100 : null;
    const resonance = resonanceAlert({
      qqqDrawdownPct: drawdown, vixChangePct: vixChange, cnnScore, session, firedKeys, day,
    });
    if (resonance) alerts.push(resonance);
  }

  // 期货大跌：夜盘和盘前最能看出隔夜情绪
  alerts.push(...futuresDropAlerts({ items: indexItems, session, firedKeys, day }));
  // 持仓整体浮亏
  if (portfolioLoss) alerts.push(...portfolioLossAlerts({ loss: portfolioLoss, session, firedKeys, day }));

  const quietQueue = [];
  const dryRunPushes = [];
  const entries = [];
  // 冷却判断要连这一轮刚接受的条目一起看，免得同一轮里自己刷屏
  const cooldownView = { alerts: [...(store?.alerts || [])] };
  for (const alert of alerts) {
    const plan = pushPlanFor(alert, settings, { quiet });
    let pushed = false;
    let sentCount = 0;
    if (plan.push && dryRun) {
      dryRunPushes.push({ text: alert.text, level: alert.level, repeat: plan.repeat });
    } else if (plan.push) {
      for (let index = 0; index < plan.repeat; index += 1) {
        const title = plan.repeat > 1
          ? `重要 ${index + 1}/${plan.repeat} · ${alert.symbol || '提醒'}`
          : `${alert.symbol || '提醒'}`;
        const result = await dispatch({
          key: `${alert.dedupe_key}:${index + 1}`,
          dedupeKey: `${alert.dedupe_key}:${index + 1}`,
          category: alert.category === 'system' ? 'data' : 'trade',
          title,
          body: [alert.text, alert.detail].filter(Boolean).join('\n'),
          createdAt: new Date(+now + index).toISOString(),
        });
        if (result?.status === 'sent') {
          pushed = true;
          sentCount += 1;
        }
      }
    }
    if (plan.queueSummary) quietQueue.push({ text: alert.text });
    // 推不推、为什么没推，都照实写进日志；日志页按这个字段显示
    // [已推送 ×3] / [免打扰] / [未推送 · 原因]。
    const pushState = pushed ? 'sent' : dryRun && plan.push ? 'dry_run' : plan.reason || 'not_pushed';
    const entry = {
      dedupe_key: alert.dedupe_key,
      category: alert.category,
      symbol: alert.symbol,
      icon: alert.icon,
      text: `${alert.text}${dryRun ? ' [测试]' : ''}${alert.detail ? `\n${alert.detail}` : ''}`,
      value: alert.value,
      threshold: alert.threshold,
      pushed,
      push_state: pushState,
      push_repeat: sentCount > 1 ? sentCount : null,
      session: alert.session || session,
      indicators: { level: alert.level === 'important' ? 1 : alert.level === 'normal' ? 2 : 3 },
      occurred_at: now.toISOString(),
    };
    // 冷却期内的同类提醒不再写一行；重要的、以及真的推送出去的照写。
    const blocked = alert.level !== 'important' && pushState !== 'sent' && withinCooldown(cooldownView, {
      symbol: alert.symbol, category: alert.category, now, cooldownMs,
    });
    if (blocked) continue;
    cooldownView.alerts.push(entry);
    entries.push(entry);
  }

  // CNN 档位状态要留在日志里，下一轮才知道是不是「穿越」；接近露头的状态同理。
  const nextStates = cnnTierStates(cnnScore, breakoutStates);
  const changed = nextStates !== tierStates || breakoutStates !== (store?.states || {});
  const withStates = changed ? { ...store, states: nextStates } : store;
  return {
    alerts,
    entries,
    quietQueue,
    dryRunPushes,
    store: entries.length ? appendAlerts(withStates, entries, now) : withStates,
  };
}

/**
 * 盘中 Z：直接取决策页「盘中预览」用的那一根未收盘日线的 zscore200，
 * 起点取最后一根完整收盘的 zscore200，口径和页面完全一致，不另算一遍。
 * 没有盘中日线（盘前、盘后、夜盘、休市）时返回 null，不拿收盘价充当盘中价。
 */
export function intradayZPreview(dashboard) {
  const series = dashboard?.dashboard?.series;
  if (!Array.isArray(series) || series.length === 0) return null;
  const reversed = [...series].reverse();
  const partial = reversed.find((point) => point && point.is_partial === true);
  const closed = reversed.find((point) => point && point.is_partial !== true);
  const currentZ = finite(partial?.zscore200);
  const previousZ = finite(closed?.zscore200);
  if (currentZ === null || previousZ === null) return null;
  return {
    previousZ, currentZ, price: finite(partial?.close), date: partial?.date ?? null,
  };
}

/**
 * 夜盘的 Z 预估：日线在夜盘不更新，没有「未收盘那根」可用，
 * 所以拿现价和最后一根完整收盘的 200 日均值/标准差估一个 Z。
 * 缺均值或标准差就返回 null，不瞎估。
 */
export function estimatedZFromPrice(dashboard, price) {
  const series = dashboard?.dashboard?.series;
  if (!Array.isArray(series)) return null;
  const closed = series.filter((point) => point && point.is_partial !== true);
  const last = closed.at(-1);
  const current = finite(price);
  const mean = finite(last?.ma200);
  const deviation = finite(last?.std200);
  if (current === null || mean === null || deviation === null || deviation <= 0) return null;
  return {
    previousZ: finite(last?.zscore200),
    currentZ: (current - mean) / deviation,
    price: current,
    basis_date: last?.date ?? null,
    estimated: true,
  };
}

/**
 * 接近露头要用的读数。常规时段看未收盘那根（和盘中 Z 一个口径），
 * 盘后用刚收盘那根做确认，连续天数都只数它之前的完整收盘。
 */
export function nearBreakoutReading(dashboard, { confirmation = false } = {}) {
  const series = dashboard?.dashboard?.series;
  if (!Array.isArray(series) || series.length === 0) return null;
  const closed = series.filter((point) => point && point.is_partial !== true);
  if (confirmation) {
    const latest = closed.at(-1);
    const currentZ = finite(latest?.zscore200);
    if (currentZ === null) return null;
    const earlier = closed.slice(0, -1);
    return {
      streak: negativeStreak(earlier),
      currentZ,
      previousZ: finite(earlier.at(-1)?.zscore200),
      price: finite(latest?.close),
    };
  }
  const partial = [...series].reverse().find((point) => point && point.is_partial === true);
  const currentZ = finite(partial?.zscore200);
  if (currentZ === null) return null;
  return {
    streak: negativeStreak(closed),
    currentZ,
    previousZ: finite(closed.at(-1)?.zscore200),
    price: finite(partial?.close),
  };
}

// 行情数据源中断超过这么久就报一条系统提醒。
export const FEED_OUTAGE_MS = 10 * 60 * 1000;

/**
 * 行情源的状态读数，交给 applyStateAlerts 做「只在状态翻转时记一行」。
 * 还没成功取过价时返回 null，免得刚启动就报警。
 */
export function feedStateReading({ lastOkAt, now = new Date(), outageMinutes = null }) {
  // Number(null) 是 0，会被当成 1970 年那一刻取过价，于是一启动就报「中断」
  if (lastOkAt === null || lastOkAt === undefined || !Number.isFinite(Number(lastOkAt))) return null;
  const elapsed = +now - Number(lastOkAt);
  if (elapsed >= FEED_OUTAGE_MS) {
    const minutes = Math.round(elapsed / 60_000);
    return {
      key: 'realtime-feed',
      state: 'triggered',
      category: 'system',
      symbol: null,
      icon: '❗',
      value: minutes,
      threshold: FEED_OUTAGE_MS / 60_000,
      text: `行情数据源中断 ${minutes} 分钟 · 实时提醒暂停，恢复后会自动继续`,
    };
  }
  return {
    key: 'realtime-feed',
    state: 'normal',
    category: 'system',
    symbol: null,
    icon: '✅',
    value: null,
    threshold: null,
    text: outageMinutes
      ? `行情数据源已恢复 · 中断约 ${outageMinutes} 分钟`
      : '行情数据源正常',
  };
}
