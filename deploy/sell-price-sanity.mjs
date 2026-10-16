// 卖出线必须和现价在同一个数量级。真实事故：TSLA 远期 PE 355 时，
// 「远期 EPS × 目标 PE」把卖出线算成 $30.98，而股价是 $367。
// 超出现价 0.5～3 倍的价格不当作有效卖出线，也不拿它触发推送。
// 前端的同一规则在 src/sellPriceSanity.ts。
export const SELL_PRICE_MIN_RATIO = 0.5;
export const SELL_PRICE_MAX_RATIO = 3;

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function sellPriceReference(plan) {
  return positive(plan?.basis_current_price) ?? positive(plan?.current_price);
}

export function isSaneSellPrice(price, reference) {
  const value = positive(price);
  const base = positive(reference);
  if (value === null || base === null) return false;
  return value >= base * SELL_PRICE_MIN_RATIO && value <= base * SELL_PRICE_MAX_RATIO;
}

/**
 * 返回一份只保留合理价格的卖出方案；全部不合理时退回 unavailable。
 * onReject 收到被丢弃的价格和当时的输入数据，供服务器日志排查。
 */
export function saneSellPricePlan(plan, reference, onReject = () => {}) {
  if (!plan || typeof plan !== 'object') return plan;
  const base = positive(reference) ?? sellPriceReference(plan);
  if (base === null) return plan;

  let rejected = false;
  const keep = (field, price) => {
    if (price === null || price === undefined) return null;
    if (isSaneSellPrice(price, base)) return price;
    rejected = true;
    onReject({
      field, price: Number(price), reference: base, method: String(plan.method || ''),
      basis_symbol: plan.basis_symbol ?? null,
      current_forward_pe: plan.current_forward_pe ?? null,
      implied_forward_eps: plan.implied_forward_eps ?? null,
    });
    return null;
  };
  const sellPrice = keep('sell_price', plan.sell_price);
  const triggerPrice = keep('trigger_price', plan.trigger_price);
  const clearPrice = keep('clear_price', plan.clear_price);
  const rawStages = Array.isArray(plan.stages) ? plan.stages : null;
  const stages = rawStages?.map((stage) => {
    const trigger = keep(`stages.${stage?.key ?? ''}`, stage?.trigger_price);
    return trigger === stage?.trigger_price ? stage : { ...stage, trigger_price: trigger, reached: false };
  });
  if (!rejected) return plan;

  const nothingLeft = sellPrice === null && triggerPrice === null
    && !(stages ?? []).some((stage) => stage?.trigger_price !== null);
  return nothingLeft
    ? {
      ...plan,
      sell_price: null, trigger_price: null, clear_price: null, stages: [], active_stage: null,
      method: 'unavailable', status: 'unavailable', quality: 'unavailable', available: false,
    }
    : { ...plan, sell_price: sellPrice, trigger_price: triggerPrice, clear_price: clearPrice, stages };
}
