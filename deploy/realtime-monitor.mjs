import { appendAlerts } from './alert-log.mjs';
import {
  bigMoveAlert, cnnAlerts, intradayZAlerts, qqqRealtimeAlerts, resonanceAlert, sessionLabel, vixAlerts,
} from './realtime-alerts.mjs';
import { pushPlanFor, realtimeDefaults } from './realtime-push.mjs';

// 一次轮询：拿到的行情 → 该写哪些提醒 → 按开关决定推不推。
// 纯靠入参，没有网络和文件操作，方便测试；网关负责喂数据和落盘。
export const MONITOR_SYMBOL_LIMIT = 24;

export function monitorSymbols({ held = [], decision = [] } = {}) {
  const list = ['QQQ', 'VIX', ...held, ...decision]
    .map((symbol) => String(symbol || '').trim().toUpperCase())
    .filter(Boolean);
  return [...new Set(list)].slice(0, MONITOR_SYMBOL_LIMIT);
}

function etDay(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
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
  settings = realtimeDefaults(),
  dispatch = async () => ({ status: 'skipped' }),
  quiet = false,
  dryRun = false,
  confirmation = false,
}) {
  const day = etDay(now);
  const firedKeys = new Set((store?.alerts || []).map((item) => item.dedupe_key));
  const held = new Set(heldSymbols.map((symbol) => String(symbol).toUpperCase()));
  const alerts = [];

  const qqq = quotes.QQQ;
  if (qqq && qqqPreviousHigh && qqqPeakDate) {
    alerts.push(...qqqRealtimeAlerts({
      price: qqq.price, previousHigh: qqqPreviousHigh, session, firedKeys, peakDate: qqqPeakDate, confirmation,
    }));
  }
  const vix = quotes.VIX;
  if (vix) {
    alerts.push(...vixAlerts({
      price: vix.price, previousClose: vix.previousClose, dayHigh: vix.dayHigh ?? null, session, firedKeys, day,
    }));
  }
  if (cnnScore !== null && cnnScore !== undefined) {
    alerts.push(...cnnAlerts({ score: cnnScore, previousScore: previousCnnScore, firedKeys, day }));
  }
  for (const [symbol, reading] of Object.entries(intradayZ)) {
    alerts.push(...intradayZAlerts({
      symbol, price: reading?.price, previousZ: reading?.previousZ, currentZ: reading?.currentZ,
      session, firedKeys, day,
    }));
  }
  for (const [symbol, quote] of Object.entries(quotes)) {
    if (symbol === 'VIX') continue;
    const move = bigMoveAlert({
      symbol, price: quote?.price, changePercent: quote?.changePercent,
      held: held.has(symbol), session, firedKeys, day,
    });
    if (move) alerts.push(move);
  }
  for (const [symbol, line] of Object.entries(sellLines)) {
    const quote = quotes[symbol];
    const trigger = Number(line?.trigger);
    const price = Number(quote?.price);
    if (!Number.isFinite(trigger) || !Number.isFinite(price) || price < trigger) continue;
    const key = `sell-line-live:${symbol}:${trigger}:${day}`;
    if (firedKeys.has(key)) continue;
    alerts.push({
      kind: 'sell_line', dedupe_key: key, category: 'sell_line', symbol, icon: '💰', level: 'important',
      value: price, threshold: trigger, session,
      text: `[${sessionLabel(session)}] ${symbol} $${price.toFixed(2)} ≥ 卖出线 $${trigger.toFixed(2)}${line?.label ? ` · ${line.label}` : ''}`,
    });
  }
  if (qqq && qqqPreviousHigh) {
    const drawdown = (Number(qqq.price) / qqqPreviousHigh - 1) * 100;
    const vixChange = vix && vix.previousClose ? (Number(vix.price) / Number(vix.previousClose) - 1) * 100 : null;
    const resonance = resonanceAlert({
      qqqDrawdownPct: drawdown, vixChangePct: vixChange, cnnScore, session, firedKeys, day,
    });
    if (resonance) alerts.push(resonance);
  }

  const quietQueue = [];
  const dryRunPushes = [];
  const entries = [];
  for (const alert of alerts) {
    const plan = pushPlanFor(alert, settings, { quiet });
    let pushed = false;
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
        if (result?.status === 'sent') pushed = true;
      }
    }
    if (plan.queueSummary) quietQueue.push({ text: alert.text });
    const marks = [];
    if (dryRun) marks.push('[测试]');
    if (plan.reason === 'quiet_hours') marks.push('[免打扰]');
    entries.push({
      dedupe_key: alert.dedupe_key,
      category: alert.category,
      symbol: alert.symbol,
      icon: alert.icon,
      text: `${alert.text}${marks.length ? ` ${marks.join(' ')}` : ''}${alert.detail ? `\n${alert.detail}` : ''}`,
      value: alert.value,
      threshold: alert.threshold,
      pushed,
      session: alert.session || session,
      indicators: { level: alert.level === 'important' ? 1 : alert.level === 'normal' ? 2 : 3 },
      occurred_at: now.toISOString(),
    });
  }

  return {
    alerts,
    entries,
    quietQueue,
    dryRunPushes,
    store: entries.length ? appendAlerts(store, entries, now) : store,
  };
}

/**
 * 盘中 Z：用最后一根完整收盘的 200 日均线和通道宽度，把现价折算成 Z-Score。
 * 不额外抓行情，只用已经缓存的 K 线仪表盘 + 实时报价，和决策页「盘中预览」同一口径。
 */
export function intradayZFromDashboard(dashboard, price) {
  // Number(null) 是 0，会把「没有价格」算成 0 元，必须先挡掉
  if (price === null || price === undefined || price === '' || typeof price === 'boolean') return null;
  const current = Number(price);
  const series = dashboard?.dashboard?.series;
  if (!Number.isFinite(current) || current <= 0 || !Array.isArray(series) || series.length === 0) return null;
  const closed = [...series].reverse().find((point) => point && point.is_partial !== true);
  const ma = Number(closed?.ma200);
  const band = Array.isArray(closed?.band200) ? closed.band200 : [];
  const upper = Number(band[1]);
  const sigma = Number(dashboard?.dashboard?.band_sigma) || 1.5;
  const previousZ = Number(closed?.zscore200);
  if (!Number.isFinite(ma) || !Number.isFinite(upper) || upper <= ma || !Number.isFinite(previousZ)) return null;
  const deviation = (upper - ma) / sigma;
  if (!(deviation > 0)) return null;
  return { previousZ, currentZ: (current - ma) / deviation, price: current };
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
