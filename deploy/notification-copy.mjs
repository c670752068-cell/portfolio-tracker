function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function symbolOf(value) {
  return String(value || '').trim().toUpperCase();
}

function compact(value, limit = 60) {
  const text = String(value || '').replace(/\s+/gu, ' ').replace(/[.!。！]+$/u, '').trim();
  return text.length <= limit ? text : `${text.slice(0, Math.max(1, limit - 1))}…`;
}

function money(value) {
  return finiteNumber(value) === null ? '—' : `$${Number(value).toFixed(2)}`;
}

function pricedTitle(icon, ticker, label, price) {
  if (finiteNumber(price) === null) return null;
  return `${icon} ${ticker} · ${label} · ${money(price)}`;
}

function event(key, title, body) {
  return { key, title: compact(title, 46), body: `${compact(body, 99)}。` };
}

export function formatBuyNotification(symbol, reason, price) {
  const ticker = symbolOf(symbol);
  const title = pricedTitle('🟢', ticker, '可买', price);
  if (!ticker || !title) return null;
  return event(
    `buy:${ticker}:${compact(reason, 44)}`,
    title,
    `${compact(reason || '买入条件已满足', 48)}；按网站计划分批买入。`,
  );
}

export function formatUnresolvedWatchlistNotification(symbols) {
  const unique = [...new Set((Array.isArray(symbols) ? symbols : [])
    .map(symbolOf).filter(Boolean))].sort();
  if (unique.length === 0) return null;
  return event(
    `growth-watchlist-unresolved:${unique.join(',')}`,
    `🟡 成长股 · ${unique.length}只待判断`,
    `${unique.join('、')} 尚未建立回撤规则；需要时请让 Codex 判断。`,
  );
}

export function formatTqqqEntryNotification(entry) {
  const benchmark = symbolOf(entry?.benchmark) || 'QQQ';
  const drawdown = Number(entry?.drawdown_pct || 0);
  const threshold = Number(entry?.threshold_pct || 0);
  const cnnScore = finiteNumber(entry?.cnn_score);
  const extremeFear = cnnScore !== null && cnnScore < 15;
  const tqqqTarget = extremeFear ? 35 : 20;
  const optionTarget = extremeFear ? 3 : 1;
  const title = pricedTitle('🟢', 'TQQQ', extremeFear ? '极恐可买' : '第一档可买', entry?.current_price);
  if (!title) return null;
  return event(
    `tqqq-entry:TQQQ:${threshold.toFixed(2)}:${tqqqTarget}:${optionTarget}`,
    title,
    extremeFear
      ? `CNN ${cnnScore.toFixed(2)}＜15；目标：TQQQ 总仓位 ${tqqqTarget}%，期权总仓位 ${optionTarget}%。`
      : `${benchmark} 回撤 ${drawdown.toFixed(2)}%；目标：TQQQ 总仓位 ${tqqqTarget}%，期权总仓位 ${optionTarget}%。`,
  );
}

export function formatCnnPositionFloorNotification(input) {
  const cnnScore = finiteNumber(input?.cnn_score);
  const current = finiteNumber(input?.current_pct);
  const target = finiteNumber(input?.target_pct);
  if (cnnScore === null || current === null || target === null || current >= target) return null;
  return event(
    `cnn-position-floor:20:${target.toFixed(0)}`,
    `🟢 CNN ${cnnScore.toFixed(2)} · 仓位不足`,
    `当前总仓位 ${current.toFixed(2)}%，目标 ${target.toFixed(0)}%；请尽量补足剩余 ${(target - current).toFixed(2)}%。`,
  );
}

export function formatVixPositionFloorNotification(input) {
  const vix = finiteNumber(input?.vix);
  const current = finiteNumber(input?.current_pct);
  const target = finiteNumber(input?.target_pct);
  if (vix === null || current === null || target === null || vix < 35 || current >= target) return null;
  const tier = vix >= 40 ? 40 : 35;
  return event(
    `vix-position-floor:${tier}:${target.toFixed(0)}`,
    `🟢 VIX ${vix.toFixed(2)} · ${tier === 40 ? '极恐加仓' : '恐慌加仓'}`,
    `当前总仓位 ${current.toFixed(2)}%，目标 ${target.toFixed(0)}%；不要害怕，按计划补足 ${(target - current).toFixed(2)}%。`,
  );
}

export function formatSellNotification(symbol, trigger, _detail, price, options = {}) {
  const ticker = symbolOf(symbol);
  const title = pricedTitle('🟠', ticker, '可卖', price);
  if (!ticker || !title) return null;
  const sellPct = finiteNumber(options?.sell_pct);
  const goldCycle = symbolOf(options?.history_basis) === 'GLD';
  const targetPrice = finiteNumber(options?.target_price);
  const triggerPrice = finiteNumber(options?.trigger_price);
  const targetPe = finiteNumber(options?.sell_forward_pe);
  const basis = symbolOf(options?.basis_symbol);
  const basisCurrent = finiteNumber(options?.basis_current_price);
  const activeStage = String(options?.active_stage || '');
  const activeStageRow = (Array.isArray(options?.stages) ? options.stages : [])
    .find((item) => String(item?.key || '') === activeStage);
  const activeStagePrice = finiteNumber(activeStageRow?.trigger_price) ?? triggerPrice;
  const forwardPriceReached = options?.target_method === 'forward_pe'
    && targetPrice !== null
    && targetPe !== null;
  const benchmarkHigh = options?.target_method === 'benchmark_high'
    && basis
    && basisCurrent !== null
    && triggerPrice !== null;
  const ndxValuation = options?.target_method === 'ndx_valuation_stages'
    && activeStageRow;
  const recoveryReached = options?.target_method === 'recovery_valuation'
    && activeStagePrice !== null;
  const stageSellPct = finiteNumber(activeStageRow?.sell_holding_pct) ?? sellPct;
  const action = ndxValuation
    ? stageSellPct === 100
      ? '清仓剩余 TQQQ 与相关期权'
      : `卖出 ${stageSellPct?.toFixed(0) || '30'}%；先期权，再杠杆指数`
    : benchmarkHigh
    ? `先处理 ${ticker} 期权，再分批减 ${ticker}`
    : recoveryReached && activeStage === 'trim_stock'
      ? '正股只分批减仓，不清空长期核心仓'
      : recoveryReached && activeStage === 'clear_derivatives'
        ? '清理剩余期权和杠杆，正股继续保留'
    : goldCycle && sellPct !== null && sellPct > 0
    ? `按网站计划卖出 ${ticker} 仓位 ${sellPct.toFixed(0)}%`
    : '先卖半仓期权，再卖杠杆，正股不急卖';
  const cause = ndxValuation
    ? `纳指100 PE ${finiteNumber(options?.current_ttm_pe)?.toFixed(2) || '已达线'} 已到${String(activeStageRow?.label || '当前卖出档')}`
    : benchmarkHigh
    ? `${basis} ${money(basisCurrent)} 已到新高 ${money(triggerPrice)}`
    : recoveryReached
      ? `${activeStage === 'trim_stock' ? '已到正股分批线' : activeStage === 'clear_derivatives' ? '已到衍生仓清理线' : '已到第一卖点'} ${money(activeStagePrice)}`
      : forwardPriceReached
    ? `达到远期 PE ${targetPe.toFixed(0)} 卖出价 ${money(targetPrice)}`
    : compact(trigger || '卖出条件已满足', 42);
  return event(
    `sell:${ticker}:${compact(trigger, 36)}`,
    title,
    `${cause}；${action}。`,
  );
}

export function formatSellNearNotification(symbol, detail, price) {
  const ticker = symbolOf(symbol);
  const title = pricedTitle('🟡', ticker, '接近卖点', price);
  if (!ticker || !title) return null;
  return event(
    `sell-near:${ticker}:${compact(detail, 44)}`,
    title,
    `${compact(detail || '接近网站卖出位置', 50)}；继续持有，等待卖出提醒。`,
  );
}

export function formatEarningsProtectionNotification(symbol, price, dateKey) {
  const ticker = symbolOf(symbol);
  const title = pricedTitle('🟣', ticker, '财报盘前保护', price);
  if (!ticker || !title) return null;
  return event(
    `earnings-protection:${ticker}:${dateKey}`,
    title,
    '财报窗口盘前上涨；不要卖，等 10:00 ET 再判断。',
  );
}

export function formatExitStageNotification(symbol, anchor, stage) {
  const ticker = symbolOf(symbol);
  const label = compact(stage?.label || '概率兑现', 12);
  const rate = Number(stage?.historical_reach_pct || 0);
  const title = pricedTitle('🟠', ticker, label, anchor?.current_price);
  if (!ticker || !title) return null;
  return event(
    `exit:${ticker}:${anchor?.low_date || 'cycle'}:${stage?.key || 'stage'}`,
    title,
    `历史到达率 ${rate.toFixed(0)}%；先卖半仓期权，再卖杠杆，正股不急卖。`,
  );
}

const ZONE_LABELS = {
  extreme_low: '极低估值',
  low: '低估值',
  middle: '中位',
  high: '高估值',
  ultra_high: '超高估值',
};

export function formatValuationNotification(symbol, raw, stockPrice) {
  const item = record(raw);
  const ticker = symbolOf(symbol);
  const zone = String(item.zone || '');
  const sellZone = zone === 'high' || zone === 'ultra_high';
  const label = sellZone ? 'PE卖点' : ZONE_LABELS[zone];
  const current = finiteNumber(item.current);
  if (ticker === 'TSLA' || !ticker || !label || current === null || item.available !== true || item.stale === true) return null;
  const icon = sellZone
    ? (zone === 'ultra_high' ? '🔴' : '🟠')
    : String(item.icon || (zone === 'middle' ? '⚪' : '🟢'));
  const title = pricedTitle(icon, ticker, label, stockPrice);
  if (!title) return null;
  const instruction = zone === 'high'
    ? '先卖半仓期权，再卖杠杆；正股不急卖。'
    : zone === 'ultra_high'
      ? '先清期权，再卖杠杆；正股最后分批。'
      : compact(item.message || '按网站规则执行', 58);
  return event(
    `valuation:${ticker}:${sellZone ? 'sell' : zone}`,
    title,
    `远期 PE ${current.toFixed(2)}；${instruction}。`,
  );
}

export function formatTargetNotification(rule, rawEvent) {
  const ticker = symbolOf(rule?.symbol);
  const reached = rawEvent?.type === 'reached';
  const title = `${reached ? '🟠' : '🟡'} ${ticker} · ${reached ? '已到目标' : '接近目标'}`;
  let action = '继续持有，等待到价。';
  if (reached && rule?.type === 'gain_pct') action = '先卖半仓期权，再卖杠杆；正股不急卖。';
  if (reached && rule?.type !== 'gain_pct') {
    const reduceTo = finiteNumber(rule?.reduce_to_pct) ?? 5;
    action = `先清期权和杠杆；正股最后分批至 ≤${reduceTo}%。`;
  }
  return {
    title,
    body: `现价 ${money(rawEvent?.currentPrice)}，目标 ${money(rawEvent?.targetPrice)}；${action}`,
  };
}

function previewPrice(snapshot, symbol) {
  const ticker = symbolOf(symbol);
  const family = record(record(snapshot?.symbols)[ticker]);
  const price = record(family.market_price).current_price;
  if (finiteNumber(price) !== null && price > 0) return price;
  const positions = Array.isArray(record(record(record(snapshot?.sell).symbols)[ticker]).positions)
    ? record(record(record(snapshot?.sell).symbols)[ticker]).positions
    : [];
  const held = positions.find((item) => symbolOf(item?.symbol) === ticker)?.current_price;
  if (finiteNumber(held) !== null && held > 0) return held;
  const depth = record(family.depth_window);
  if (!/基准/u.test(String(depth.price_note || '')) && finiteNumber(depth.current_price) !== null) {
    return depth.current_price;
  }
  throw new Error(`preview requires ${ticker} asset price`);
}

export function buildNotificationPreviewEvents(snapshot) {
  const price = (symbol) => previewPrice(snapshot, symbol);
  const nvdaPrice = price('NVDA');
  const valuation = (symbol, stockPrice, current, zone, icon, message) => formatValuationNotification(symbol, {
    current, zone, icon, message, available: true, stale: false,
  }, stockPrice);
  return [
    formatBuyNotification('NVDA', '价格、估值和仓位条件均已通过', nvdaPrice),
    formatTqqqEntryNotification({ benchmark: 'QQQ', drawdown_pct: 11.25, threshold_pct: 11, cnn_score: 20, current_price: price('TQQQ') }),
    formatTqqqEntryNotification({ benchmark: 'QQQ', drawdown_pct: 11.25, threshold_pct: 11, cnn_score: 14.5, current_price: price('TQQQ') }),
    formatCnnPositionFloorNotification({ cnn_score: 20, current_pct: 48, target_pct: 60 }),
    formatVixPositionFloorNotification({ vix: 35, current_pct: 48, target_pct: 60 }),
    formatVixPositionFloorNotification({ vix: 40, current_pct: 65, target_pct: 70 }),
    valuation('MSFT', price('MSFT'), 21.8, 'extreme_low', '🟢', '按计划加到该股目标仓位，不因盘前波动恐慌卖出。'),
    valuation('GOOG', price('GOOG'), 24.8, 'low', '🟢', '按计划分批买入或继续持有。'),
    valuation('NVDA', nvdaPrice, 31.2, 'high', '🟠', '清理期权和杠杆仓位。'),
    formatEarningsProtectionNotification('MSFT', price('MSFT'), '2026-08-10'),
  ].filter(Boolean);
}
