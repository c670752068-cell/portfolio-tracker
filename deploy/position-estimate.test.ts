import { describe, expect, it } from 'vitest';
import {
  ESTIMATE_MAX_AGE_MS, ESTIMATE_MAX_RATIO, ESTIMATE_MIN_RATIO, estimatePositionValues,
} from './position-estimate.mjs';

// 字段照线上 /api/portfolio/positions 的真实结构抄的（as_of 2026-10-15，IBKR 晚一个交易日）
const payload = () => ({
  as_of: '2026-10-15',
  currency: 'USD',
  net_liquidation: 186_325.007,
  broker: 'IBKR+LONGPORT+FUTU',
  positions: [
    { broker: 'IBKR', symbol: 'TSLA', asset_type: 'stock', qty: 17, market_value: 6161.48, cost_basis: 6464.99 },
    { broker: 'IBKR', symbol: 'AVL', asset_type: 'stock', qty: 100, market_value: 3390, cost_basis: 3500 },
    { broker: 'IBKR', symbol: 'MCD', asset_type: 'option', qty: 2, market_value: 1200, cost_basis: 1000, contract_multiplier: 100 },
  ],
});
const now = new Date('2026-10-17T07:45:00Z');
const quote = (price: number, minutesAgo = 1) => ({
  price, priceTime: new Date(+now - minutesAgo * 60_000).toISOString(), session: 'closed',
});

describe('用最新价重算持仓市值', () => {
  it('按最新价重算正股市值，现金推算口径保持不变', () => {
    const next = estimatePositionValues(payload(), { TSLA: quote(354.72), AVL: quote(31.26) }, { now });

    const tsla = next.positions.find((item) => item.symbol === 'TSLA');
    const avl = next.positions.find((item) => item.symbol === 'AVL');
    expect(tsla).toMatchObject({ market_value: 17 * 354.72, market_value_source: 'live_quote' });
    expect(avl).toMatchObject({ market_value: 100 * 31.26, market_value_source: 'live_quote' });

    // 现金 = 净值 − 持仓市值合计；两边同步调整，推算出来的现金一分不差
    const before = payload();
    const cashBefore = before.net_liquidation - before.positions.reduce((sum, item) => sum + item.market_value, 0);
    const cashAfter = next.net_liquidation - next.positions.reduce((sum, item) => sum + item.market_value, 0);
    expect(cashAfter).toBeCloseTo(cashBefore, 6);
  });

  it('期权不重算（拿不到期权实时价），原值照搬', () => {
    const next = estimatePositionValues(payload(), { TSLA: quote(354.72), MCD: quote(250) }, { now });

    const mcd = next.positions.find((item) => item.asset_type === 'option');
    expect(mcd?.market_value).toBe(1200);
    expect(mcd?.market_value_source).toBeUndefined();
    expect(next.estimate.skipped).toContain('MCD');
  });

  it('报价太旧就不用', () => {
    const stale = { TSLA: quote(354.72, ESTIMATE_MAX_AGE_MS / 60_000 + 5) };
    const next = estimatePositionValues(payload(), stale, { now });

    expect(next.positions.find((item) => item.symbol === 'TSLA')?.market_value).toBe(6161.48);
    expect(next.estimate).toBeUndefined();
  });

  it('价格离券商口径太远就不用（防止取错标的或坏数据）', () => {
    const broker = 6161.48 / 17; // 362.44
    const tooLow = { TSLA: quote(broker * (ESTIMATE_MIN_RATIO - 0.01)) };
    const tooHigh = { TSLA: quote(broker * (ESTIMATE_MAX_RATIO + 0.01)) };

    expect(estimatePositionValues(payload(), tooLow, { now }).estimate).toBeUndefined();
    expect(estimatePositionValues(payload(), tooHigh, { now }).estimate).toBeUndefined();
  });

  it('一个都重算不了时原样返回同一个对象', () => {
    const original = payload();
    expect(estimatePositionValues(original, {}, { now })).toBe(original);
  });

  it('记下这次估算用的是什么价、哪一天的', () => {
    const next = estimatePositionValues(payload(), { TSLA: quote(354.72), AVL: quote(31.26) }, { now });

    expect(next.estimate).toMatchObject({
      source: 'live_quote',
      priced: ['TSLA', 'AVL'],
      skipped: ['MCD'],
    });
    expect(next.estimate.price_as_of).toBe(new Date(+now - 60_000).toISOString());
    // 券商对账日期不动：它是净值序列和数据新鲜度在用的
    expect(next.as_of).toBe('2026-10-15');
  });

  it('数量为 0 或价格不合法的跳过，不写出 0 市值', () => {
    const broken = payload();
    broken.positions.push({ broker: 'IBKR', symbol: 'ZERO', asset_type: 'stock', qty: 0, market_value: 0, cost_basis: 0 });
    const next = estimatePositionValues(broken, { ZERO: quote(10), TSLA: quote(354.72) }, { now });

    expect(next.positions.find((item) => item.symbol === 'ZERO')?.market_value).toBe(0);
    expect(next.estimate.priced).toEqual(['TSLA']);
  });

  it('空值不当成 0', () => {
    const next = estimatePositionValues(payload(), { TSLA: { price: null, priceTime: now.toISOString() } }, { now });
    expect(next.estimate).toBeUndefined();
  });
});
