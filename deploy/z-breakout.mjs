// Zero crossings are observations, not buy/sell instructions. The reference
// sessions prevent a missing ticker bar from being silently counted as a day.
export const BREAKOUT_MIN_SESSIONS = 15;

export function analyzeBreakouts(symbol, series, sessionDates, asOf) {
  const dates = [...new Set(sessionDates.filter(date => date <= asOf))].sort();
  const points = new Map((series || []).filter(p => !p.is_partial).map(p => [p.date, p]));
  const history = [];
  let sign = 0, count = 0, previousZ = null, validSessions = 0;
  let latest = { status: 'unavailable', as_of: asOf, event: null, reason: '缺少有效收盘数据或交易日参照，暂无法判断。' };
  for (const date of dates) {
    const point = points.get(date);
    const z = point?.zscore200;
    const valid = typeof z === 'number' && Number.isFinite(z);
    if (!valid) {
      sign = 0; count = 0; previousZ = null; validSessions = 0;
      latest = { status: 'unavailable', as_of: date, event: null, reason: '该交易日数据缺失，连续计数中断。' };
      continue;
    }
    const nextSign = Math.sign(z);
    validSessions++;
    let event = null;
    if (nextSign && sign && nextSign !== sign && count >= BREAKOUT_MIN_SESSIONS) {
      const direction = nextSign > 0 ? 'up' : 'down';
      event = { id: `${symbol}:${date}:${direction}`, symbol, date, direction,
        sessions: count, previous_z: previousZ, z, confirmed: true };
      history.push(event);
    }
    // Null and zero both break continuity; neither can confirm a crossing.
    const enough = validSessions > BREAKOUT_MIN_SESSIONS || event || nextSign === 0;
    latest = { status: event ? 'triggered' : enough ? 'none' : 'insufficient', as_of: date, event,
      reason: event ? '完整收盘确认；穿越零轴，不等于极值或买卖信号。'
        : enough ? '未发生符合条件的零轴穿越。' : '尚无连续 15 个同号有效交易日，暂未确认露头。' };
    count = nextSign && nextSign === sign ? count + 1 : nextSign ? 1 : 0;
    sign = nextSign; previousZ = z;
  }
  if (!dates.length || dates.at(-1) !== asOf) latest = { status: 'unavailable', as_of: asOf, event: null, reason: '交易日参照尚未更新，暂无法判断。' };
  return { ...latest, history: history.slice(-50), minimum_sessions: BREAKOUT_MIN_SESSIONS };
}

export function breakoutPushBatches(events, now, occurredAt) {
  return ['up', 'down'].flatMap(direction => {
    const rows = events.filter(e => e.direction === direction);
    if (!rows.length) return [];
    const label = direction === 'up' ? '向上露头' : '向下露头';
    const signed = n => `${n >= 0 ? '+' : ''}${n.toFixed(3)}`;
    return [{ category: 'breakout', direction, title: `Z-Score ${label} · ${rows.length} 个标的`,
      body: rows.map(e => `${e.symbol}：连续${e.sessions}个同号交易日后，Z ${signed(e.previous_z)} → ${signed(e.z)}；${e.date} 已收盘确认。`).join('\n') + '\n仅为位置变化提醒，不等于买卖或极值信号。',
      dedupeKey: `breakout:${rows.map(e => e.id).sort().join('|')}`, createdAt: now.toISOString(), occurredAt }];
  });
}
