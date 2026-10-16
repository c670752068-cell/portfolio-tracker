// 实时提醒的推送策略：分三级、重要的连发、免打扰期间只记日志并在结束后汇总。
// 所有新开关默认关闭，用户回来自己在设置里打开。
export const REALTIME_FLAG_BY_KIND = {
  drawdown: 'qqqDrawdown',
  drawdown_confirm: 'qqqDrawdown',
  rise: 'vix',
  level: 'vix',
  relief: 'vix',
  tier: 'cnn',
  deeper: 'cnn',
  z_cross: 'intradayZ',
  big_move: 'bigMove',
  sell_line: 'sellLine',
  holdings: 'holdings',
  resonance: 'resonance',
};

export function realtimeDefaults() {
  return {
    enabled: false,
    qqqDrawdown: false,
    vix: false,
    cnn: false,
    intradayZ: false,
    bigMove: false,
    sellLine: false,
    holdings: false,
    resonance: false,
    importantRepeat: 3,
    quietSummary: true,
  };
}

/** 老的设置文件没有 realtime 字段时补上默认值，其他设置原样不动。 */
export function mergeRealtimeSettings(settings) {
  const defaults = realtimeDefaults();
  const current = settings && typeof settings.realtime === 'object' && settings.realtime !== null ? settings.realtime : {};
  const realtime = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (key === 'importantRepeat') {
      const value = Number(current[key]);
      realtime[key] = [1, 2, 3].includes(value) ? value : defaults[key];
    } else if (typeof current[key] === 'boolean') {
      realtime[key] = current[key];
    }
  }
  return { ...settings, realtime };
}

export function pushPlanFor(alert, realtime, { quiet = false } = {}) {
  const settings = realtime && typeof realtime === 'object' ? realtime : realtimeDefaults();
  if (alert?.level === 'log_only') return { push: false, repeat: 0, reason: 'log_only', queueSummary: false };
  if (!settings.enabled) return { push: false, repeat: 0, reason: 'realtime_disabled', queueSummary: false };
  const flag = REALTIME_FLAG_BY_KIND[alert?.kind];
  if (!flag || settings[flag] !== true) return { push: false, repeat: 0, reason: 'category_disabled', queueSummary: false };
  if (quiet) {
    return {
      push: false,
      repeat: 0,
      reason: 'quiet_hours',
      queueSummary: alert?.level === 'important' && settings.quietSummary === true,
    };
  }
  const repeat = alert?.level === 'important' ? settings.importantRepeat : 1;
  return { push: true, repeat, reason: null, queueSummary: false };
}

/** 免打扰结束时，把期间攒下的重要提醒合成一条。 */
export function quietSummaryEvent(pending, now = new Date()) {
  const items = Array.isArray(pending) ? pending.filter((item) => item && item.text) : [];
  if (items.length === 0) return null;
  return {
    key: `realtime-quiet-summary:${now.toISOString()}`,
    category: 'system',
    title: `免打扰期间 ${items.length} 条重要提醒`,
    body: items.map((item) => String(item.text).replace(/^\[[^\]]+\]\s*/, '')).join('；'),
    createdAt: now.toISOString(),
  };
}
