// 并行对比：服务器自己跑起来之后，把「服务器算的」和「Mac 推上来的」逐项比一遍。
// 只读、只比较、只写一条系统提醒，不改任何数据，也不切换数据来源。
export const COMPARE_TOLERANCE = {
  // 两边取价时间不同，市值有小幅差很正常
  marketValuePct: 1,
  navPct: 0.5,
  drawdownPp: 0.5,
  cnnPoints: 2,
  pePoints: 1,
};
const MAX_LISTED = 5;

function finite(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function bySymbol(positions) {
  const map = new Map();
  for (const raw of Array.isArray(positions) ? positions : []) {
    const item = typeof raw === 'object' && raw !== null ? raw : {};
    const symbol = String(item.symbol || '').trim().toUpperCase().replace(/^US\./, '');
    if (!symbol) continue;
    const previous = map.get(symbol);
    map.set(symbol, {
      symbol,
      qty: (previous?.qty ?? 0) + (finite(item.qty) ?? 0),
      marketValue: (previous?.marketValue ?? 0) + (finite(item.market_value) ?? 0),
    });
  }
  return map;
}

/** 持仓逐项比：数量对不上、市值差太多、某一边多出来的都列出来。 */
export function comparePositions(macPositions, serverPositions) {
  const mac = bySymbol(macPositions);
  const server = bySymbol(serverPositions);
  const diffs = [];
  for (const [symbol, left] of mac) {
    const right = server.get(symbol);
    if (!right) {
      diffs.push({ kind: 'missing_on_server', symbol, mac: left.qty, server: null });
      continue;
    }
    if (left.qty !== right.qty) {
      diffs.push({ kind: 'qty', symbol, mac: left.qty, server: right.qty });
      continue;
    }
    const base = Math.abs(left.marketValue);
    if (base > 0) {
      const gap = Math.abs(right.marketValue - left.marketValue) / base * 100;
      if (gap > COMPARE_TOLERANCE.marketValuePct) {
        diffs.push({ kind: 'market_value', symbol, mac: left.marketValue, server: right.marketValue });
      }
    }
  }
  for (const [symbol, right] of server) {
    if (!mac.has(symbol)) diffs.push({ kind: 'missing_on_mac', symbol, mac: null, server: right.qty });
  }
  return diffs;
}

function compareValue(field, left, right, tolerance, relative = false) {
  const a = finite(left);
  const b = finite(right);
  if (a === null || b === null) return [{ kind: 'missing', field, mac: a, server: b }];
  const gap = relative ? (Math.abs(b - a) / Math.abs(a || 1)) * 100 : Math.abs(b - a);
  return gap > tolerance ? [{ kind: 'value', field, mac: a, server: b }] : [];
}

/** 净值和量化快照里的几个关键数逐项比。 */
export function compareSnapshots(mac, server) {
  const left = mac?.snapshot || {};
  const right = server?.snapshot || {};
  return [
    ...compareValue('nav', mac?.nav, server?.nav, COMPARE_TOLERANCE.navPct, true),
    ...compareValue('qqq_drawdown_pct', left.qqq_drawdown_pct, right.qqq_drawdown_pct, COMPARE_TOLERANCE.drawdownPp),
    ...compareValue('cnn', left.cnn, right.cnn, COMPARE_TOLERANCE.cnnPoints),
    ...compareValue('ndx_pe', left.ndx_pe, right.ndx_pe, COMPARE_TOLERANCE.pePoints),
  ];
}

/** 对比结果折成一条状态读数，交给 applyStateAlerts（状态翻转才写日志）。 */
export function compareReadingForAlerts(diffs) {
  const rows = Array.isArray(diffs) ? diffs : [];
  if (rows.length === 0) {
    return {
      key: 'source-compare', state: 'normal', category: 'system', symbol: null, icon: '✅',
      value: 0, threshold: null, text: '服务器与 Mac 的数据一致',
    };
  }
  const listed = rows.slice(0, MAX_LISTED)
    .map((item) => item.symbol || item.field)
    .join('、');
  return {
    key: 'source-compare', state: 'triggered', category: 'system', symbol: null, icon: '❗',
    value: rows.length, threshold: null,
    text: `两边数据对不上 · 共 ${rows.length} 项 · ${listed}${rows.length > MAX_LISTED ? ' 等' : ''}`
      + ' · 先以 Mac 为准，等核对后再切换',
  };
}
