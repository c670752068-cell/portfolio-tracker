// 券商同步失败要在日志里留一行系统提醒：失败时记一条，恢复时记一条。
// 走 applyStateAlerts 的「状态翻转才写」机制，所以同一个错误不会天天刷屏。
export const BROKER_NAMES = { IBKR: 'IBKR', LONGPORT: '长桥', FUTU: '富途' };

function rows(value) {
  return Array.isArray(value) ? value : [];
}

export function brokerHealthReadings(snapshot) {
  const source = snapshot?.freshness?.broker_health ?? snapshot?.broker_health;
  return rows(source).flatMap((raw) => {
    const item = typeof raw === 'object' && raw !== null ? raw : {};
    const broker = String(item.broker || '').toUpperCase();
    if (!broker) return [];
    const name = BROKER_NAMES[broker] || broker;
    const failed = item.available === false;
    const asOf = typeof item.as_of === 'string' ? item.as_of : null;
    return [{
      key: `broker:${broker}`,
      state: failed ? 'triggered' : 'normal',
      category: 'system',
      symbol: null,
      icon: failed ? '❗' : '✅',
      value: null,
      threshold: null,
      text: failed
        ? `${name} 同步失败 · ${String(item.error_code || '未知错误')} · 持仓和决策仍用上一份数据`
        : `${name} 同步已恢复${asOf ? ` · 对账日 ${asOf}` : ''}`,
    }];
  });
}
