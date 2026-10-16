import { describe, expect, it, vi } from 'vitest';
import {
  SELL_PRICE_MAX_RATIO, SELL_PRICE_MIN_RATIO, isSaneSellPrice, saneSellPricePlan, sellPriceReference,
} from './sell-price-sanity.mjs';

// 线上快照 2026-10-16：TSLA 现价 367.16，远期 PE 355 把卖出线算成 30.98。
const tslaPlan = {
  available: true, method: 'recovery_valuation', status: 'reached', quality: 'current_estimate',
  basis_symbol: 'TSLA', current_price: 367.16, basis_current_price: 367.16,
  current_forward_pe: 355.53, implied_forward_eps: 1.032712,
  sell_price: 30.98, trigger_price: 30.98, clear_price: 33.05,
  action_stage_key: 'reduce_risk', active_stage: 'trim_stock',
  stages: [
    { key: 'reduce_risk', label: '开始降风险', trigger_price: 30.98, reached: true },
    { key: 'trim_stock', label: '正股分批减仓', trigger_price: 30.98, reached: true },
  ],
};

describe('推送侧的卖出线合理性校验', () => {
  it('阈值与前端一致：现价的 0.5 倍到 3 倍', () => {
    expect([SELL_PRICE_MIN_RATIO, SELL_PRICE_MAX_RATIO]).toEqual([0.5, 3]);
    expect(isSaneSellPrice(394.42, 394.42)).toBe(true);
    expect(isSaneSellPrice(30.98, 382.7)).toBe(false);
    expect(isSaneSellPrice(1_200, 382.7)).toBe(false);
    expect(isSaneSellPrice(null, 382.7)).toBe(false);
    expect(isSaneSellPrice(394.42, null)).toBe(false);
  });

  it('基准价优先 basis_current_price', () => {
    expect(sellPriceReference(tslaPlan)).toBe(367.16);
    expect(sellPriceReference({ current_price: 148.58 })).toBe(148.58);
    expect(sellPriceReference({})).toBeNull();
  });

  it('离谱的卖出线整份退回 unavailable，并记录输入数据', () => {
    const onReject = vi.fn();
    const plan = saneSellPricePlan(tslaPlan, 382.7, onReject);

    expect(plan.method).toBe('unavailable');
    expect(plan.sell_price).toBeNull();
    expect(plan.trigger_price).toBeNull();
    expect(plan.stages).toEqual([]);
    expect(onReject).toHaveBeenCalled();
    expect(onReject.mock.calls[0][0]).toMatchObject({ field: 'sell_price', price: 30.98, reference: 382.7 });
  });

  it('合理的方案原样返回', () => {
    const plan = { available: true, method: 'forward_pe', sell_price: 394.42, current_price: 394.42 };

    expect(saneSellPricePlan(plan, 394.42)).toBe(plan);
  });

  it('没有任何基准价时不做判断，方案原样返回', () => {
    const noReference = { available: true, method: 'recovery_valuation', sell_price: 30.98 };

    expect(saneSellPricePlan(noReference, null)).toBe(noReference);
  });

  it('没传基准价时退回方案自带的现价继续校验', () => {
    expect(saneSellPricePlan(tslaPlan, null).method).toBe('unavailable');
  });
});
