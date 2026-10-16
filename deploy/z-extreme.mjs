// Notification-only thresholds. This never changes channel ±1.5 or BUY rules.
export function analyzeExtreme(symbol, series, sessionDates, asOf, rule) {
  const dates = [...new Set(sessionDates.filter(date => date <= asOf))].sort();
  const points = new Map((series || []).filter(p => !p.is_partial).map(p => [p.date, p.zscore200]));
  const previousDate = dates.at(-2);
  const z = points.get(asOf), previousZ = points.get(previousDate);
  const valid = dates.at(-1) === asOf && previousDate && [z, previousZ].every(n => typeof n === 'number' && Number.isFinite(n));
  if (!valid) return { status: 'unavailable', as_of: asOf, event: null };
  const direction = z >= rule.positiveThreshold && previousZ < rule.positiveThreshold ? 'positive'
    : z <= -rule.negativeThreshold && previousZ > -rule.negativeThreshold ? 'negative' : null;
  const threshold = direction ? rule[`${direction}Threshold`] : null;
  return { status: direction ? 'triggered' : 'none', as_of: asOf, event: direction ? {
    id: `z-extreme:${symbol}:${asOf}:${direction}`, symbol, date: asOf, previous_date: previousDate,
    direction, threshold, z, previous_z: previousZ, confirmed: true,
  } : null };
}

export function extremePushBatches(events, now, occurredAt) {
  const signed = n => `${n >= 0 ? '+' : ''}${n.toFixed(3)}`;
  return ['positive', 'negative'].flatMap(direction => {
    const rows = events.filter(e => e.direction === direction);
    if (!rows.length) return [];
    const threshold = rows[0].threshold;
    const boundary = `${direction === 'positive' ? '+' : '−'}${threshold}`;
    return [{ category: 'zExtreme', direction, threshold, confirmed: true,
      title: `Z-Score ${boundary} 阈值提醒 · ${rows.length} 个标的`,
      body: rows.map(e => `${e.symbol}：Z ${signed(e.previous_z)} → ${signed(e.z)}，首次进入${direction === 'positive' ? '正值' : '负值'}提醒区；${e.date} 完整收盘确认。`).join('\n')
        + '\n这是自定义阈值提醒，不代表已到 ±1.5，也不改变回撤买入判断。',
      dedupeKey: rows.map(e => e.id).sort().join('|'), createdAt: now.toISOString(), occurredAt }];
  });
}
