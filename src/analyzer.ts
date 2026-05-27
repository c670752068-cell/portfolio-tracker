import type { PortfolioMetrics, RiskFinding } from './types';

const SINGLE_STOCK_WARN = 0.25;
const SINGLE_STOCK_CRIT = 0.4;
const SECTOR_WARN = 0.45;
const SECTOR_CRIT = 0.6;
const CASH_LOW = 0.05;
const CASH_HIGH = 0.4;
const CASH_VERY_HIGH = 0.6;
const MIN_HOLDINGS_FOR_DIVERSIFICATION = 5;

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

  if (metrics.cashWeight >= CASH_VERY_HIGH) {
    findings.push({
      level: 'warn',
      title: `现金仓位过高 ${(metrics.cashWeight * 100).toFixed(1)}%`,
      detail: `现金占比 ${(metrics.cashWeight * 100).toFixed(1)}%，长期持有现金跑不赢通胀。如有明确防御意图可保留，否则建议分批建仓。`,
    });
  } else if (metrics.cashWeight >= CASH_HIGH) {
    findings.push({
      level: 'info',
      title: `现金仓位偏高 ${(metrics.cashWeight * 100).toFixed(1)}%`,
      detail: '若非主动择时，可考虑配置短债或货币基金以提高资金效率。',
    });
  } else if (metrics.cashWeight < CASH_LOW && metrics.totalValue > 0) {
    findings.push({
      level: 'warn',
      title: `现金仓位过低 ${(metrics.cashWeight * 100).toFixed(1)}%`,
      detail: '几乎满仓，缺乏回调加仓与应急流动性。建议保留 5%–15% 现金。',
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
      detail: '跌幅超过 20%，建议复盘买入逻辑是否仍成立，决定加仓 / 持有 / 止损。',
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
