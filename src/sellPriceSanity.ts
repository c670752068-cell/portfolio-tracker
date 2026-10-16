import type { QuantSellFamily, QuantSellPricePlan } from './types';

// 卖出线必须和现价在同一个数量级。真实事故：TSLA 远期 PE 355 时，
// 「远期 EPS × 目标 PE」算出 $30.98 的卖出线，而股价是 $367。
// 超出现价 0.5～3 倍的价格一律不当作有效卖出线，页面沿用原有的
// 「暂时无法测算 / 待测算」显示，推送侧也不拿它当触发价。
export const SELL_PRICE_MIN_RATIO = 0.5;
export const SELL_PRICE_MAX_RATIO = 3;

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

// 基准价：指数类方案的触发价用底层基准的价格口径，个股两者相同。
export function sellPriceReference(plan: QuantSellPricePlan): number | null {
  return positive(plan.basis_current_price) ?? positive(plan.current_price);
}

export function isSaneSellPrice(price: unknown, reference: unknown): boolean {
  const value = positive(price);
  const base = positive(reference);
  if (value === null || base === null) return false;
  return value >= base * SELL_PRICE_MIN_RATIO && value <= base * SELL_PRICE_MAX_RATIO;
}

export function withSaneSellPrices(family: QuantSellFamily): QuantSellFamily {
  const plan = family.sell_price_plan;
  if (!plan) return family;
  const reference = sellPriceReference(plan);
  if (reference === null) return family;

  const keep = (price: number | null | undefined) => (
    price === null || price === undefined || isSaneSellPrice(price, reference) ? price : null
  );
  const sellPrice = keep(plan.sell_price);
  const triggerPrice = keep(plan.trigger_price);
  const clearPrice = keep(plan.clear_price);
  const stages = plan.stages?.map((stage) => {
    const trigger = keep(stage.trigger_price);
    return trigger === stage.trigger_price ? stage : { ...stage, trigger_price: trigger, reached: false };
  });
  const stagesChanged = Boolean(stages?.some((stage, index) => stage !== plan.stages?.[index]));
  if (sellPrice === plan.sell_price && triggerPrice === plan.trigger_price
    && clearPrice === plan.clear_price && !stagesChanged) return family;

  const nothingLeft = !positive(sellPrice) && !positive(triggerPrice)
    && !(stages ?? []).some((stage) => positive(stage.trigger_price));
  const sanitized: QuantSellPricePlan = nothingLeft
    ? {
      ...plan,
      sell_price: null, trigger_price: null, clear_price: null, stages: [], active_stage: null,
      method: 'unavailable', status: 'unavailable', quality: 'unavailable', available: false,
    }
    : { ...plan, sell_price: sellPrice, trigger_price: triggerPrice, clear_price: clearPrice, stages };
  return { ...family, sell_price_plan: sanitized };
}
