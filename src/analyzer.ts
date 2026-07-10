import type { PortfolioMetrics, RiskFinding } from './types';

const SINGLE_STOCK_WARN = 0.25;
const SINGLE_STOCK_CRIT = 0.4;
const SECTOR_WARN = 0.45;
const SECTOR_CRIT = 0.6;
const CASH_LOW = 0.05;
const CASH_HIGH = 0.4;
const CASH_VERY_HIGH = 0.6;
const MIN_HOLDINGS_FOR_DIVERSIFICATION = 5;
const OPTION_WEIGHT_WARN = 0.25;
const OPTION_WEIGHT_CRIT = 0.4;
const SHORT_DTE_CRIT = 21;
const SHORT_DTE_WARN = 45;
const UNDERLYING_EXPOSURE_WARN = 0.4;
const UNDERLYING_EXPOSURE_CRIT = 0.65;

export function analyzePortfolio(metrics: PortfolioMetrics): RiskFinding[] {
  const findings: RiskFinding[] = [];

  if (metrics.totalValue <= 0) {
    findings.push({
      level: 'info',
      title: '尚无数据',
      detail: '请先添加持仓或现金，再进行分析。',
    });
    return findings;
  }

  for (const m of metrics.holdingsMetrics) {
    if (m.weight >= SINGLE_STOCK_CRIT) {
      findings.push({
        level: 'critical',
        title: `${m.holding.symbol} 单股集中度过高 ${(m.weight * 100).toFixed(1)}%`,
        detail: `单一股票占总资产 ${(m.weight * 100).toFixed(1)}%，超过 ${(SINGLE_STOCK_CRIT * 100).toFixed(0)}% 警戒线。建议分散到多只标的，单股权重控制在 25% 以内。`,
      });
    } else if (m.weight >= SINGLE_STOCK_WARN) {
      findings.push({
        level: 'warn',
        title: `${m.holding.symbol} 仓位偏重 ${(m.weight * 100).toFixed(1)}%`,
        detail: `占总资产 ${(m.weight * 100).toFixed(1)}%，已接近集中度上限，留意单一公司事件风险。`,
      });
    }
  }

  if (metrics.unconvertedItems.length > 0) {
    findings.push({
      level: 'warn',
      title: `${metrics.unconvertedItems.length} 个条目未纳入美元总资产`,
      detail: `这些条目使用了未支持的币种：${metrics.unconvertedItems.join('、')}。请把币种改为 USD、CNY 或 HKD 后再看风险占比。`,
    });
  }

  for (const [sector, weight] of Object.entries(metrics.sectorWeights)) {
    if (weight >= SECTOR_CRIT) {
      findings.push({
        level: 'critical',
        title: `${sector} 行业过度集中 ${(weight * 100).toFixed(1)}%`,
        detail: `${sector} 占股票仓位 ${(weight * 100).toFixed(1)}%，行业风险共振显著。建议引入弱相关行业（如消费、医疗、能源）。`,
      });
    } else if (weight >= SECTOR_WARN) {
      findings.push({
        level: 'warn',
        title: `${sector} 行业偏重 ${(weight * 100).toFixed(1)}%`,
        detail: `${sector} 板块占比偏高，行业回撤会显著影响整体净值。`,
      });
    }
  }

  const optionUnderlyings = new Set(
    metrics.holdingsMetrics
      .filter((metric) => metric.holding.assetType === 'option')
      .map((metric) => metric.holding.option?.underlying || metric.holding.symbol),
  );
  for (const [symbol, exposure] of Object.entries(metrics.underlyingExposure)) {
    if (!optionUnderlyings.has(symbol)) continue;
    const exposureWeight = metrics.totalValue > 0 ? Math.abs(exposure) / metrics.totalValue : 0;
    if (exposureWeight >= UNDERLYING_EXPOSURE_CRIT) {
      findings.push({
        level: 'critical',
        title: `${symbol} 的 Delta 调整后暴露约为总资产 ${(exposureWeight * 100).toFixed(1)}%`,
        detail: '该数值会把已识别 Delta 的期权折算为标的正股暴露，并与同标的正股合并；它用于展示敏感度，不等同于期权市值。',
      });
    } else if (exposureWeight >= UNDERLYING_EXPOSURE_WARN) {
      findings.push({
        level: 'warn',
        title: `${symbol} 的 Delta 调整后暴露约为总资产 ${(exposureWeight * 100).toFixed(1)}%`,
        detail: '该数值已合并同标的正股与可计算 Delta 的期权暴露，标的价格变动可能对组合产生较大影响。',
      });
    }
  }

  if (metrics.cashWeight >= CASH_VERY_HIGH) {
    findings.push({
      level: 'warn',
      title: `现金仓位过高 ${(metrics.cashWeight * 100).toFixed(1)}%`,
      detail: `现金占比 ${(metrics.cashWeight * 100).toFixed(1)}%。这不是错误；请结合你的流动性需求和投资期限，确认这是否符合原先计划。`,
    });
  } else if (metrics.cashWeight >= CASH_HIGH) {
    findings.push({
      level: 'info',
      title: `现金仓位偏高 ${(metrics.cashWeight * 100).toFixed(1)}%`,
      detail: '这不一定是风险；请确认该比例是否是你有意保留的流动性或等待资金。',
    });
  } else if (metrics.cashWeight < CASH_LOW && metrics.totalValue > 0) {
    findings.push({
      level: 'warn',
      title: `现金仓位过低 ${(metrics.cashWeight * 100).toFixed(1)}%`,
      detail: '组合接近满仓，流动性缓冲较小。请结合应急资金与近期现金需求自行评估。',
    });
  }

  const holdingCount = metrics.holdingsMetrics.length;
  if (holdingCount > 0 && holdingCount < MIN_HOLDINGS_FOR_DIVERSIFICATION) {
    findings.push({
      level: 'info',
      title: `持仓数仅 ${holdingCount} 只，分散度有限`,
      detail: '少于 5 只标的时，个股波动会直接放大组合波动。',
    });
  }

  const losers = metrics.holdingsMetrics.filter((m) => m.pnlPct <= -0.2);
  for (const l of losers) {
    findings.push({
      level: 'warn',
      title: `${l.holding.symbol} 浮亏 ${(l.pnlPct * 100).toFixed(1)}%`,
      detail: '跌幅超过 20%。这是复盘提示，不构成加仓、持有或卖出的建议。',
    });
  }

  const options = metrics.holdingsMetrics.filter((m) => m.holding.assetType === 'option');
  if (metrics.optionWeight >= OPTION_WEIGHT_CRIT) {
    findings.push({
      level: 'critical',
      title: `期权权利金占比偏高 ${(metrics.optionWeight * 100).toFixed(1)}%`,
      detail: '期权市值在总资产中的比例较高。期权会同时受到时间、波动率和标的价格影响，组合波动可能显著放大。',
    });
  } else if (metrics.optionWeight >= OPTION_WEIGHT_WARN) {
    findings.push({
      level: 'warn',
      title: `期权权利金占比 ${(metrics.optionWeight * 100).toFixed(1)}%`,
      detail: '请结合到期日、隐含波动率和自身可承受回撤确认该比例。长到期期权不会仅因“是期权”被判定为高风险。',
    });
  }

  for (const metric of options) {
    const option = metric.holding.option;
    const dte = option?.expiration ? daysUntil(option.expiration) : null;
    if (dte !== null && dte < 0) {
      findings.push({
        level: 'critical',
        title: `${metric.holding.symbol} 的到期日已过`,
        detail: '请核对截图日期或持仓状态；过期合约的数据不应继续用于风险判断。',
      });
    } else if (dte !== null && dte <= SHORT_DTE_CRIT) {
      findings.push({
        level: 'critical',
        title: `${metric.holding.symbol} 距到期仅 ${dte} 天`,
        detail: '短期期权的时间价值衰减和价格敏感度通常更高，需特别留意到期安排。',
      });
    } else if (dte !== null && dte <= SHORT_DTE_WARN) {
      findings.push({
        level: 'warn',
        title: `${metric.holding.symbol} 距到期 ${dte} 天`,
        detail: '该合约已进入较短到期期限；这是时间风险提示，不代表该仓位必须调整。',
      });
    }
    if (metric.pnlPct <= -0.5 && metric.cost > 0) {
      findings.push({
        level: 'critical',
        title: `${metric.holding.symbol} 期权浮亏 ${(metric.pnlPct * 100).toFixed(1)}%`,
        detail: '亏损幅度较大，请同时核对到期日、合约方向、Delta 和原始交易计划。',
      });
    }
    if (option?.delta == null || !option.expiration) {
      findings.push({
        level: 'info',
        title: `${metric.holding.symbol} 期权数据不完整`,
        detail: `缺少${option?.delta == null ? ' Delta' : ''}${option?.delta == null && !option?.expiration ? ' 和' : ''}${!option?.expiration ? ' 到期日' : ''}，无法完整计算等效正股暴露或时间风险。`,
      });
    }
  }

  for (const metric of metrics.holdingsMetrics.filter((m) => m.holding.assetType === 'leveraged_etf')) {
    findings.push({
      level: 'warn',
      title: `${metric.holding.symbol} 为杠杆 ETF`,
      detail: '杠杆 ETF 通常按日重置，较长持有期可能出现路径依赖和波动损耗；该提示不代表买卖建议。',
    });
  }

  if (findings.length === 0) {
    findings.push({
      level: 'info',
      title: '当前未发现明显结构性风险',
      detail: '集中度、行业分布、现金比、个股盈亏均在合理区间。继续关注宏观与持仓基本面变化。',
    });
  }

  return findings;
}

function daysUntil(dateText: string): number | null {
  const normalized = dateText.includes('T') ? dateText : `${dateText}T00:00:00`;
  const target = new Date(normalized);
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target.getTime() - Date.now()) / 86_400_000);
}
