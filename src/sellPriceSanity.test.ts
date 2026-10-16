import { describe, expect, it } from 'vitest';
import {
  SELL_PRICE_MAX_RATIO, SELL_PRICE_MIN_RATIO, isSaneSellPrice, sellPriceReference, withSaneSellPrices,
} from './sellPriceSanity';
import type { QuantSellFamily, QuantSellPricePlan } from './types';

// 线上快照 2026-10-16 的真实数据：TSLA 现价 367.16，远期 PE 355 导致卖出线算成 30.98。
const tslaPlan = {
  method: 'recovery_valuation', available: true, status: 'reached', quality: 'current_estimate',
  basis_symbol: 'TSLA', current_price: 367.16, basis_current_price: 367.16,
  current_forward_pe: 355.53, implied_forward_eps: 1.032712, sell_forward_pe: null,
  sell_price: 30.98, trigger_price: 30.98, clear_price: 33.05, clear_forward_pe: null,
  gap_pct: 0, action_stage_key: 'reduce_risk', active_stage: 'trim_stock',
  source: '历史高点 + 5年 TTM PE + 远期 PE', as_of: '2026-10-16 01:48:56',
  target_portfolio_weight_pct: 5, note: '普通个股不豁免；历史高点和估值线取更早触发者',
  stages: [
    { key: 'reduce_risk', label: '开始降风险', trigger_price: 30.98, trigger_kind: 'forward_valuation', reached: true, action: '先卖半仓期权' },
    { key: 'clear_derivatives', label: '清理衍生仓', trigger_price: 33.05, trigger_kind: 'forward_valuation', reached: true, action: '清理剩余期权和杠杆' },
    { key: 'trim_stock', label: '正股分批减仓', trigger_price: 30.98, trigger_kind: 'forward_valuation', reached: true, action: '正股只分批减仓' },
  ],
} as unknown as QuantSellPricePlan;

function family(plan: QuantSellPricePlan, overrides: Partial<QuantSellFamily> = {}): QuantSellFamily {
  return {
    family: 'TSLA', market_value: 8_445.12, held_symbols: ['TSLA', 'TSLL'], positions: [],
    sell_price_plan: plan, ...overrides,
  } as unknown as QuantSellFamily;
}

describe('卖出线合理性校验', () => {
  it('阈值是现价的 0.5 倍到 3 倍', () => {
    expect([SELL_PRICE_MIN_RATIO, SELL_PRICE_MAX_RATIO]).toEqual([0.5, 3]);
    expect(isSaneSellPrice(446.56, 346.25)).toBe(true);
    expect(isSaneSellPrice(39, 37.14)).toBe(true);
    expect(isSaneSellPrice(171.9, 82.28)).toBe(true);
    expect(isSaneSellPrice(30.98, 367.16)).toBe(false);
    expect(isSaneSellPrice(1_200, 367.16)).toBe(false);
    expect(isSaneSellPrice(183.58, 367.16)).toBe(true);
    expect(isSaneSellPrice(183.57, 367.16)).toBe(false);
  });

  it('基准价优先用 basis_current_price，再退回 current_price', () => {
    expect(sellPriceReference(tslaPlan)).toBe(367.16);
    expect(sellPriceReference({ ...tslaPlan, basis_current_price: null } as QuantSellPricePlan)).toBe(367.16);
    expect(sellPriceReference({
      ...tslaPlan, basis_current_price: null, current_price: null,
    } as QuantSellPricePlan)).toBeNull();
  });

  it('TSLA $30.98 不再当作卖出线，整份方案退回「暂时无法测算」', () => {
    const sanitized = withSaneSellPrices(family(tslaPlan));
    const plan = sanitized.sell_price_plan!;

    expect(plan.sell_price).toBeNull();
    expect(plan.trigger_price).toBeNull();
    expect(plan.clear_price).toBeNull();
    expect(plan.stages).toEqual([]);
    expect(plan.method).toBe('unavailable');
    expect(plan.status).toBe('unavailable');
    expect(plan.quality).toBe('unavailable');
    expect(plan.available).toBe(false);
    expect(plan.active_stage).toBeNull();
    // 现价和估值口径保留，便于排查
    expect(plan.current_price).toBe(367.16);
    expect(plan.current_forward_pe).toBe(355.53);
  });

  it('合理的方案原样返回，不改任何字段', () => {
    const avgo = family({
      ...tslaPlan, basis_symbol: 'AVGO', current_price: 346.25, basis_current_price: 346.25,
      sell_price: 446.56, trigger_price: 446.56, clear_price: 468.65, status: 'waiting',
      stages: [{ key: 'reduce_risk', label: '开始降风险', trigger_price: 363.2, trigger_kind: 'ttm_valuation', reached: false, action: '先卖半仓期权' }],
    } as unknown as QuantSellPricePlan, { family: 'AVGO' });

    expect(withSaneSellPrices(avgo)).toBe(avgo);
  });

  it('只有个别档位离谱时，只清掉那一档，保留其余卖点', () => {
    const mixed = family({
      ...tslaPlan, current_price: 100, basis_current_price: 100, sell_price: 150,
      trigger_price: 150, clear_price: 180, status: 'waiting',
      stages: [
        { key: 'reduce_risk', label: '开始降风险', trigger_price: 120, trigger_kind: 'ttm_valuation', reached: false, action: 'a' },
        { key: 'trim_stock', label: '正股分批减仓', trigger_price: 3.4, trigger_kind: 'forward_valuation', reached: true, action: 'b' },
      ],
    } as unknown as QuantSellPricePlan);
    const plan = withSaneSellPrices(mixed).sell_price_plan!;

    expect(plan.sell_price).toBe(150);
    expect(plan.method).toBe('recovery_valuation');
    expect(plan.stages?.map((stage) => stage.trigger_price)).toEqual([120, null]);
    expect(plan.stages?.[1].reached).toBe(false);
  });

  it('没有现价可比时不做判断，原样返回', () => {
    const noReference = family({
      ...tslaPlan, current_price: null, basis_current_price: null,
    } as unknown as QuantSellPricePlan);

    expect(withSaneSellPrices(noReference)).toBe(noReference);
  });

  it('本来就没有卖出方案的族不受影响', () => {
    const bare = { family: 'NAIL', market_value: 1_471.2, held_symbols: ['NAIL'], positions: [] } as unknown as QuantSellFamily;

    expect(withSaneSellPrices(bare)).toBe(bare);
  });
});
