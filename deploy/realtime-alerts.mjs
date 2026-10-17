// 实时提醒的判定。全是纯函数：给价格和上一次的状态，返回要写进提醒日志的条目。
// 阈值都写在这里，方便以后改；这些档位只用于提醒，不改变任何买卖判定。
export const SESSION_CADENCE_MS = {
  regular: 60_000,
  pre: 120_000,
  post: 120_000,
  overnight: 300_000,
  closed: 900_000,
};
export const QQQ_DRAWDOWN_TIERS = [5, 10, 15, 20, 25, 30];
// 防抖：离档位不到这么多个百分点就不触发，免得价格在档位附近来回刷屏。
export const TIER_DEBOUNCE_PP = 0.15;
export const VIX_RISE_TIERS = [15, 25, 35];
export const VIX_LEVEL_TIERS = [20, 23, 30];
export const VIX_RELIEF_DROP_PCT = 15;
export const CNN_TIERS = [30, 25, 20, 15];
// 30 就是原有的「到达开仓线」，两边算同一个事件，不重复记。
export const CNN_OPEN_FLOOR = 30;
export const CNN_STEP = 5;
export const Z_TIERS = [0.5, 1, 1.5, 2, 2.5];
export const STOCK_BIG_MOVE_PCT = 5;
export const QQQ_BIG_MOVE_PCT = 2;
export const RESONANCE_HISTORY_NOTE = '历史参考（2015 年以来，按收盘价统计）：VIX 单日涨超 30% 且 QQQ 当天跌超 2% 共 21 次——第二天收盘更低只有 38%，5 天内出现更低收盘 67%（中位数再低约 1.5%），当天收盘买入持有 20 天胜率 81%、60 天胜率 86%；最差的一次是 2020-02-24，20 天后 -22.8%。VIX 涨超 25% 且 QQQ 跌超 1.5% 共 30 次：第二天更低 40%，5 天内更低 67%，20 天胜率 63%，60 天胜率 77%。';

const SESSION_LABELS = { pre: '盘前', regular: '盘中', post: '盘后', overnight: '夜盘', closed: '休市' };

export function sessionLabel(session) {
  return SESSION_LABELS[session] || '当前';
}

function tag(session, confirmation = false) {
  return confirmation ? '[收盘确认]' : `[${sessionLabel(session)}]`;
}

function finite(value) {
  // Number(null) 是 0：不挡掉就会写出「较上次 0 回升 21 点」这种假话
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** QQQ 实时回撤档位。firedKeys 是已经记过的 dedupe_key 集合。 */
export function qqqRealtimeAlerts({
  price, previousHigh, session, firedKeys, peakDate, confirmation = false,
}) {
  const current = finite(price);
  const high = finite(previousHigh);
  if (current === null || high === null || high <= 0) return [];
  const drawdown = (current / high - 1) * 100;
  const alerts = [];
  for (const tier of QQQ_DRAWDOWN_TIERS) {
    const key = `qqq-drawdown-${confirmation ? 'confirm' : 'live'}:${tier}:${peakDate}`;
    if (firedKeys.has(key)) continue;
    // 防抖：要跌破档位且留出余量才算
    if (drawdown > -tier - TIER_DEBOUNCE_PP) continue;
    alerts.push({
      kind: confirmation ? 'drawdown_confirm' : 'drawdown',
      tier,
      dedupe_key: key,
      category: 'drawdown',
      symbol: 'QQQ',
      icon: '📉',
      level: tier >= 5 ? 'important' : 'normal',
      value: drawdown,
      threshold: -tier,
      session: confirmation ? 'closed' : session,
      text: `${tag(session, confirmation)} QQQ ${current.toFixed(2)} · 离前高 ${drawdown.toFixed(1)}% · 本轮${confirmation ? '收盘确认' : '首次'}跌破 -${tier}%`,
    });
  }
  return alerts;
}

/** VIX：较昨收的涨幅档位、绝对值档位、以及从当日高点的回落。 */
export function vixAlerts({ price, previousClose, dayHigh = null, session, firedKeys, day }) {
  const current = finite(price);
  const previous = finite(previousClose);
  if (current === null) return [];
  const alerts = [];
  const changePct = previous && previous > 0 ? (current / previous - 1) * 100 : null;

  if (changePct !== null) {
    for (const tier of VIX_RISE_TIERS) {
      const key = `vix-rise:${tier}:${day}`;
      if (firedKeys.has(key) || changePct < tier) continue;
      alerts.push({
        kind: 'rise', tier, dedupe_key: key, category: 'sentiment', symbol: 'VIX', icon: '⚡',
        level: tier >= 25 ? 'important' : 'normal', value: current, threshold: tier, session,
        text: `${tag(session)} VIX ${current.toFixed(2)} · 较昨收 +${changePct.toFixed(1)}% · 波动率飙升`,
      });
    }
  }
  for (const tier of VIX_LEVEL_TIERS) {
    const key = `vix-level:${tier}:${day}`;
    if (firedKeys.has(key) || current < tier) continue;
    alerts.push({
      kind: 'level', tier, dedupe_key: key, category: 'sentiment', symbol: 'VIX', icon: '⚡',
      level: tier >= 23 ? 'important' : 'normal', value: current, threshold: tier, session,
      text: `${tag(session)} VIX ${current.toFixed(2)} · 升破 ${tier}`,
    });
  }
  const high = finite(dayHigh);
  if (high !== null && high > 0) {
    const dropPct = (1 - current / high) * 100;
    const key = `vix-relief:${day}`;
    if (!firedKeys.has(key) && (dropPct >= VIX_RELIEF_DROP_PCT || (current < 20 && high >= 20))) {
      alerts.push({
        kind: 'relief', dedupe_key: key, category: 'sentiment', symbol: 'VIX', icon: '🌤',
        level: 'normal', value: current, threshold: null, session,
        text: `${tag(session)} VIX ${current.toFixed(2)} · 从今日高点 ${high.toFixed(1)} 回落 ${dropPct.toFixed(0)}%`,
      });
    }
  }
  return alerts;
}

/**
 * CNN 恐惧贪婪：跌破档位、比上次又降一截、以及回升。
 * floorReported = 原有的「到达开仓线」已经记过，这一轮就不再单独写「跌破 30」。
 */
export function cnnAlerts({ score, previousScore = null, firedKeys, day, floorReported = false }) {
  const current = finite(score);
  if (current === null) return [];
  const previous = finite(previousScore);
  const alerts = [];
  // 一次跨过多档合并成一行，用最深那一档；更深的档位已经记过就不再回头补浅档。
  const firedDeepest = Math.min(...CNN_TIERS.filter((tier) => firedKeys.has(`cnn-tier:${tier}:${day}`)), Infinity);
  const crossed = CNN_TIERS
    .filter((tier) => current < tier && tier < firedDeepest)
    .filter((tier) => !(floorReported && tier === CNN_OPEN_FLOOR));
  if (crossed.length > 0) {
    const deepest = Math.min(...crossed);
    alerts.push({
      kind: 'tier', tier: deepest, dedupe_key: `cnn-tier:${deepest}:${day}`,
      category: 'sentiment', symbol: 'CNN', icon: '😱',
      level: deepest <= 20 ? 'important' : 'normal', value: current, threshold: deepest, session: null,
      text: `CNN 恐惧贪婪 ${current.toFixed(0)} · 跌破 ${
        [...crossed].sort((left, right) => right - left).join(' / ')
      }${current < 25 ? ' · 极度恐惧' : ''}`,
    });
  }
  if (previous !== null && previous - current >= CNN_STEP) {
    const key = `cnn-deeper:${current.toFixed(0)}:${day}`;
    if (!firedKeys.has(key)) {
      alerts.push({
        kind: 'deeper', dedupe_key: key, category: 'sentiment', symbol: 'CNN', icon: '😱',
        level: current <= 20 ? 'important' : 'normal', value: current, threshold: null, session: null,
        text: `CNN 恐惧贪婪 ${current.toFixed(0)} · 较上次 ${previous.toFixed(0)} 再降 ${(previous - current).toFixed(0)} 点（恐慌加剧）`,
      });
    }
  }
  if (previous !== null && (current - previous >= CNN_STEP || (current >= 30 && previous < 30))) {
    const key = `cnn-relief:${current.toFixed(0)}:${day}`;
    if (!firedKeys.has(key)) {
      alerts.push({
        kind: 'relief', dedupe_key: key, category: 'sentiment', symbol: 'CNN', icon: '🙂',
        level: 'normal', value: current, threshold: null, session: null,
        text: `CNN 恐惧贪婪 ${current.toFixed(0)} · ${current >= 30 ? '回到 30 以上' : `较上次 ${previous.toFixed(0)} 回升 ${(current - previous).toFixed(0)} 点`}`,
      });
    }
  }
  return alerts;
}

/** 盘中 Z-Score 穿档：向下穿 = 跌得更深，向上穿 = 涨得更多。 */
export function intradayZAlerts({ symbol, price, previousZ, currentZ, session, firedKeys, day }) {
  const from = finite(previousZ);
  const to = finite(currentZ);
  if (from === null || to === null || !symbol) return [];
  const alerts = [];
  for (const tier of Z_TIERS) {
    for (const sign of [-1, 1]) {
      const level = tier * sign;
      const down = sign < 0 ? from > level && to <= level : false;
      const up = sign > 0 ? from < level && to >= level : false;
      if (!down && !up) continue;
      const direction = down ? 'down' : 'up';
      const key = `z-cross:${symbol}:${level}:${direction}:${day}`;
      if (firedKeys.has(key)) continue;
      const important = tier === 1.5 || tier >= 2;
      alerts.push({
        kind: 'z_cross', tier: level, direction, dedupe_key: key, category: 'zscore', symbol,
        icon: down ? '🟢' : '🔴',
        level: important ? 'important' : tier === 1 ? 'normal' : 'log_only',
        value: to, threshold: level, session,
        text: `${tag(session)} ${symbol}${finite(price) === null ? '' : ` $${Number(price).toFixed(2)}`} · Z ${from.toFixed(2)} → ${to.toFixed(2)} · ${
          down
            ? tier >= 1.5 ? '跌得更深，已进入买入区' : `跌得更深，接近买入区 -1.5`
            : tier >= 1.5 ? '涨得更多，进入卖出区' : '涨得更多，接近卖出区 +1.5'
        }`,
      });
    }
  }
  return alerts;
}

/** 个股当天大幅波动。QQQ 用 ±2%，其他用 ±5%。 */
export function bigMoveAlert({ symbol, price, changePercent, held, session, firedKeys, day }) {
  const change = finite(changePercent);
  if (change === null || !symbol) return null;
  const movePct = change * 100;
  const limit = symbol === 'QQQ' ? QQQ_BIG_MOVE_PCT : STOCK_BIG_MOVE_PCT;
  if (Math.abs(movePct) < limit) return null;
  const key = `big-move:${symbol}:${movePct > 0 ? 'up' : 'down'}:${day}`;
  if (firedKeys.has(key)) return null;
  return {
    kind: 'big_move', dedupe_key: key, category: 'other', symbol, icon: '⚠️',
    level: held ? 'normal' : 'log_only', value: movePct, threshold: limit, session,
    text: `${tag(session)} ${symbol} ${movePct > 0 ? '+' : ''}${movePct.toFixed(1)}%${
      finite(price) === null ? '' : ` · ${Number(price).toFixed(2)}`
    } · ${held ? '持仓标的' : '观察标的'}${movePct > 0 ? '大涨' : '大跌'}`,
  };
}

/** 多指标共振：QQQ 回撤 ≤ -5%、VIX 较昨收 ≥ +25%、CNN ≤ 25 同时成立。 */
export function resonanceAlert({ qqqDrawdownPct, vixChangePct, cnnScore, session, firedKeys, day }) {
  const drawdown = finite(qqqDrawdownPct);
  const vix = finite(vixChangePct);
  const cnn = finite(cnnScore);
  if (drawdown === null || vix === null || cnn === null) return null;
  if (drawdown > -5 || vix < 25 || cnn > 25) return null;
  const key = `resonance:${day}`;
  if (firedKeys.has(key)) return null;
  return {
    kind: 'resonance', dedupe_key: key, category: 'other', symbol: 'QQQ', icon: '⭐',
    level: 'important', value: drawdown, threshold: -5, session,
    text: `${tag(session)} 多指标共振：QQQ ${drawdown.toFixed(1)}% · VIX +${vix.toFixed(0)}% · CNN ${cnn.toFixed(0)}${
      session === 'closed' ? '' : ' · 以上按收盘价统计，今天还没收盘'
    }`,
    detail: RESONANCE_HISTORY_NOTE,
  };
}
