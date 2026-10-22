import { sessionLabel } from './realtime-alerts.mjs';

// 持仓整体浮亏：用最新价格（含夜盘、盘前、盘后）估算全部持仓今天的盈亏，
// 占总资产跌到 -2% / -4% 时提醒一次。只提醒，不构成任何买卖指令。
export const PORTFOLIO_LOSS_TIERS = [2, 4];
const TIER_LEVELS = { 2: 'normal', 4: 'important' };
const OPTION_MULTIPLIER = 100;
const TOP_LOSERS = 3;

function finite(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function money(value) {
  const rounded = Math.round(Math.abs(value));
  return `${value < 0 ? '-' : ''}$${rounded.toLocaleString('en-US')}`;
}

/** 今天的预估盈亏：每个标的 (现价 − 昨收) × 数量；没有报价的单独列出来。 */
export function portfolioDayLoss({ positions = [], quotes = {}, nav = null } = {}) {
  const bySymbol = new Map();
  const missing = [];
  for (const raw of positions) {
    const item = typeof raw === 'object' && raw !== null ? raw : {};
    const symbol = String(item.symbol || '').trim().toUpperCase().replace(/^US\./, '');
    const qty = finite(item.qty ?? item.quantity);
    if (!symbol || qty === null || qty === 0) continue;
    const quote = quotes[symbol];
    const price = finite(quote?.price);
    const previousClose = finite(quote?.previousClose);
    if (price === null || previousClose === null) {
      if (!missing.includes(symbol)) missing.push(symbol);
      continue;
    }
    const multiplier = String(item.asset_type || '') === 'option' ? OPTION_MULTIPLIER : 1;
    const pnl = (price - previousClose) * qty * multiplier;
    bySymbol.set(symbol, (bySymbol.get(symbol) || 0) + pnl);
  }
  const pnl = [...bySymbol.values()].reduce((total, value) => total + value, 0);
  const total = finite(nav);
  return {
    pnl,
    pct: total === null || total <= 0 ? null : (pnl / total) * 100,
    nav: total,
    losers: [...bySymbol.entries()]
      .map(([symbol, value]) => ({ symbol, pnl: value }))
      .filter((item) => item.pnl < 0)
      .sort((left, right) => left.pnl - right.pnl)
      .slice(0, TOP_LOSERS),
    missing,
  };
}

export function portfolioLossAlerts({ loss, session, firedKeys, day }) {
  const pct = finite(loss?.pct);
  if (pct === null || pct >= 0) return [];
  const names = (loss.losers || []).map((item) => item.symbol).join('、');
  const missing = (loss.missing || []).length
    ? `（${loss.missing.join('、')} 无夜盘报价，按最后价格计算）`
    : '';
  const alerts = [];
  for (const tier of PORTFOLIO_LOSS_TIERS) {
    const key = `portfolio-loss:${tier}:${day}`;
    if (firedKeys.has(key) || pct > -tier) continue;
    alerts.push({
      kind: 'portfolio_loss', dedupe_key: key, category: 'position', symbol: null, icon: '💼',
      level: TIER_LEVELS[tier] || 'normal', value: pct, threshold: -tier, session,
      text: `[${sessionLabel(session)}] 持仓今日预估 ${money(loss.pnl)}（${pct.toFixed(2)}%）`
        + `${names ? `· 主要来自 ${names}` : ''}${missing} · 可以去看看是否加仓`,
    });
  }
  return alerts;
}
