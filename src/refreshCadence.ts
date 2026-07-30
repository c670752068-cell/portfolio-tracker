export const REFRESH_CADENCE = {
  quantAnalysis: {
    label: '量化快照',
    interval: '盘中每 5 分钟；其他时段每 25 分钟',
    scope: '条件与裁决',
  },
  quotes: {
    label: '网站行情',
    interval: '美股盘中每 35 分钟',
    scope: '持仓价格与涨跌',
  },
  alerts: {
    label: '提醒检查',
    interval: '盘中每 35 分钟',
    scope: '目标提醒',
  },
  brokers: {
    label: '券商汇总',
    interval: '每 45 分钟',
    scope: 'IBKR、长桥与富途持仓',
  },
  dailyFallback: {
    label: '日线兜底',
    interval: '北京时间每天 7 点后一次',
    scope: '未自动同步时的日线刷新',
  },
} as const;
