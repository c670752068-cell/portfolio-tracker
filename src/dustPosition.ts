import type { QuantPosition, QuantSellFamily } from './types';

// 券商清仓后留下的零碎股或残值（例如 NVDA 只剩 0.005 股 / $1.09）视为已清仓：
// 不进入持仓列表、卖出军令和「已持仓」筛选。阈值集中在这里，便于日后调整。
export const DUST_MARKET_VALUE_USD = 10;
export const DUST_MINIMUM_SHARES = 1;

export function isDustQuantPosition(position: QuantPosition): boolean {
  const marketValue = Number(position.market_value);
  if (Number.isFinite(marketValue) && Math.abs(marketValue) < DUST_MARKET_VALUE_USD) return true;
  // 期权按张数计，1 张不是零碎仓；只对股票和 ETF 用「不足 1 股」判断。
  if (position.asset_type === 'option') return false;
  const shares = Number(position.qty);
  return Number.isFinite(shares) && shares !== 0 && Math.abs(shares) < DUST_MINIMUM_SHARES;
}

export function isDustSellFamily(family: QuantSellFamily): boolean {
  const marketValue = Number(family.market_value);
  return Number.isFinite(marketValue) && Math.abs(marketValue) < DUST_MARKET_VALUE_USD;
}
