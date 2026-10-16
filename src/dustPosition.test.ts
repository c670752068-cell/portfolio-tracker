import { describe, expect, it } from 'vitest';
import { DUST_MARKET_VALUE_USD, isDustQuantPosition, isDustSellFamily } from './dustPosition';
import type { QuantPosition, QuantSellFamily } from './types';

function position(overrides: Partial<QuantPosition> = {}): QuantPosition {
  return {
    broker: 'IBKR', symbol: 'NVDA', asset_type: 'stock', qty: 10, market_value: 2_180, ...overrides,
  } as QuantPosition;
}

function family(overrides: Partial<QuantSellFamily> = {}): QuantSellFamily {
  return { family: 'NVDA', market_value: 1.09, held_symbols: ['NVDA'], positions: [], ...overrides } as QuantSellFamily;
}

describe('零碎持仓规则', () => {
  it('把券商清仓后残留的 NVDA 0.005 股 / $1.09 当作已清仓', () => {
    expect(isDustQuantPosition(position({ qty: 0.005, market_value: 1.09 }))).toBe(true);
  });

  it('保留正常持仓', () => {
    expect(isDustQuantPosition(position())).toBe(false);
    expect(isDustQuantPosition(position({ symbol: 'SGOV', asset_type: 'etf', qty: 1359, market_value: 136_633.86 }))).toBe(false);
  });

  it('市值低于阈值即视为已清仓，即使股数是整数', () => {
    expect(isDustQuantPosition(position({ qty: 3, market_value: 2.4 }))).toBe(true);
    expect(isDustQuantPosition(position({ qty: 3, market_value: DUST_MARKET_VALUE_USD }))).toBe(false);
  });

  it('不足 1 股的碎股视为已清仓，期权 1 张不算碎仓', () => {
    expect(isDustQuantPosition(position({ qty: 0.4, market_value: 400 }))).toBe(true);
    expect(isDustQuantPosition(position({
      symbol: 'PDD', asset_type: 'option', qty: 1, market_value: 22.13,
    }))).toBe(false);
  });

  it('卖出军令里市值不足阈值的族视为已清仓', () => {
    expect(isDustSellFamily(family())).toBe(true);
    expect(isDustSellFamily(family({ family: 'PDD', market_value: 22.13 }))).toBe(false);
    expect(isDustSellFamily(family({ family: 'TSLA', market_value: 8_445.12 }))).toBe(false);
  });

  it('市值缺失时不猜测，按保留处理', () => {
    expect(isDustQuantPosition(position({ qty: 10, market_value: Number.NaN }))).toBe(false);
    expect(isDustSellFamily(family({ market_value: Number.NaN }))).toBe(false);
  });
});
