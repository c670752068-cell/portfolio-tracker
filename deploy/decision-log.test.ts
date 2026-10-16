import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyCashFlow, applyTradeNote, captureNav, captureTrades, createDecisionLogRoute, emptyDecisionLog,
  readDecisionLog, removeCashFlow, sameSiteWrite, tradeKey, writeDecisionLog,
} from './decision-log.mjs';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function root() {
  const value = await mkdtemp(join(tmpdir(), 'decision-log-'));
  roots.push(value);
  return value;
}

// 字段路径照线上快照（2026-10-16）抄的真实结构
const snapshot = {
  ammo_overview: { nav_usd: 185_419.71 },
  context: { cnn_fear_greed: { available: true, score: 31.4571428571429 }, vix: { available: true, value: 16.46 } },
  valuation_tab: { ndx: { as_of: '2026-10-15', current_pe: 30.0447 } },
  symbols: {
    QQQ: { depth_window: { current_pct: 4.371706 } },
    TSLA: { depth_window: { current_pct: 24.49 }, ma_slope: { annualized_pct: -12.5, as_of: '2026-10-15' } },
  },
  sell: { symbols: { TSLA: { decision: { evidence: { valuation: { current_pe: 335.592, percentile: 85.6459 } } } } } },
  position_ledger: {
    recent_events: [
      {
        asset_type: 'stock', broker: 'IBKR', side: 'BUY', symbol: 'TSLA', quantity: 17,
        price: 380.293984, price_source: 'broker_cost_delta', estimated: false,
        recorded_at: '2026-10-13T00:37:24.190147-04:00',
      },
      {
        asset_type: 'stock', broker: 'FUTU', side: 'SELL', symbol: 'NVDA', quantity: 0.005,
        price: null, price_source: 'unavailable', estimated: true,
        recorded_at: '2026-10-14T06:21:14.455457-04:00',
      },
      { side: 'BUY', symbol: '', quantity: 1, recorded_at: '2026-10-14T06:21:14.455457-04:00' },
    ],
  },
};
const channelReview = { symbols: { TSLA: { z_score: -0.75, as_of: '2026-10-15' } } };

describe('决策日志的数据层', () => {
  it('从量化快照抓成交，并记下成交那一刻的指标', () => {
    const store = captureTrades(emptyDecisionLog(), snapshot, {
      now: new Date('2026-10-16T08:00:00Z'), channelReview,
    });

    expect(store.trades).toHaveLength(2);
    const tsla = store.trades.find((trade) => trade.symbol === 'TSLA')!;
    expect(tsla).toMatchObject({
      side: 'BUY', qty: 17, price: 380.293984, price_estimated: false, broker: 'IBKR', status: 'pending_note',
    });
    expect(tsla.amount).toBeCloseTo(6_464.997728, 6);
    expect(tsla.indicators).toEqual({
      qqq_drawdown_pct: 4.371706,
      symbol_drawdown_pct: 24.49,
      z_score: -0.75,
      z_score_as_of: '2026-10-15',
      ma200_slope_pct: -12.5,
      sma_slope_pct: null,
      ttm_pe: 335.592,
      ttm_pe_percentile: 85.6459,
      cnn_fear_greed: 31.4571428571429,
      vix: 16.46,
      ndx_pe: 30.0447,
    });
  });

  it('卖出价缺失时存空值，不补造', () => {
    const store = captureTrades(emptyDecisionLog(), snapshot, { now: new Date('2026-10-16T08:00:00Z') });
    const nvda = store.trades.find((trade) => trade.symbol === 'NVDA')!;

    expect(nvda).toMatchObject({ side: 'SELL', price: null, amount: null, price_estimated: true, price_source: 'unavailable' });
    expect(nvda.indicators.ttm_pe).toBeNull();
  });

  it('同一笔成交重复抓取不会变成两条', () => {
    const first = captureTrades(emptyDecisionLog(), snapshot, { now: new Date('2026-10-16T08:00:00Z') });
    const second = captureTrades(first, snapshot, { now: new Date('2026-10-16T08:45:00Z') });

    expect(second.trades).toHaveLength(2);
    expect(second.revision).toBe(first.revision);
    expect(tradeKey(snapshot.position_ledger.recent_events[0])).toBe('IBKR|TSLA|BUY|17|2026-10-13T00:37:24.190147-04:00');
  });

  it('每日净值一天一条，数值没变就不写新版本', () => {
    const day = captureNav(emptyDecisionLog(), snapshot, { now: new Date('2026-10-16T08:00:00Z'), date: '2026-10-16' });
    expect(day.nav_series).toEqual([expect.objectContaining({ date: '2026-10-16', nav: 185_419.71 })]);

    const again = captureNav(day, snapshot, { now: new Date('2026-10-16T12:00:00Z'), date: '2026-10-16' });
    expect(again.revision).toBe(day.revision);

    const moved = captureNav(day, { ammo_overview: { nav_usd: 186_000 } }, { now: new Date('2026-10-16T20:00:00Z'), date: '2026-10-16' });
    expect(moved.nav_series).toHaveLength(1);
    expect(moved.nav_series[0].nav).toBe(186_000);

    const next = captureNav(moved, snapshot, { now: new Date('2026-10-17T20:00:00Z'), date: '2026-10-17' });
    expect(next.nav_series.map((point) => point.date)).toEqual(['2026-10-16', '2026-10-17']);
  });

  it('补填理由和预判后进入「进行中」，卖出价可以手工补', () => {
    const store = captureTrades(emptyDecisionLog(), snapshot, { now: new Date('2026-10-16T08:00:00Z') });
    const nvda = store.trades.find((trade) => trade.symbol === 'NVDA')!;
    const next = applyTradeNote(store, nvda.id, {
      trigger: ['take_profit', 'cnn', '乱填的'],
      prediction: { type: 'rebuy_after_dip', dip_pct: 10 },
      note: '涨太快先卖一半',
      price: 228,
    }, new Date('2026-10-16T09:00:00Z'));
    const updated = next.trades.find((trade) => trade.id === nvda.id)!;

    expect(updated.trigger).toEqual(['take_profit', 'cnn']);
    expect(updated.prediction).toEqual({ type: 'rebuy_after_dip', dip_pct: 10, reference_symbol: 'QQQ' });
    expect(updated).toMatchObject({ status: 'in_progress', price: 228, price_source: 'manual', price_estimated: false });
    expect(updated.amount).toBeCloseTo(1.14, 2);
  });

  it('预判参数不合法就报 400，找不到交易报 404', () => {
    const store = captureTrades(emptyDecisionLog(), snapshot, { now: new Date('2026-10-16T08:00:00Z') });
    const id = store.trades[0].id;

    expect(() => applyTradeNote(store, id, { prediction: { type: 'rebuy_after_dip', dip_pct: 0 } })).toThrow('回调幅度');
    expect(() => applyTradeNote(store, id, { prediction: { type: 'beat_qqq', horizon_months: 2 } })).toThrow('1 / 3 / 6 / 12');
    expect(() => applyTradeNote(store, id, { prediction: { type: '乱写' } })).toThrow('预判类型');
    expect(() => applyTradeNote(store, 'trade-missing', {})).toThrow('找不到这笔交易');
  });

  it('出入金可以加和删，金额或日期不合法就拒绝', () => {
    const added = applyCashFlow(emptyDecisionLog(), { date: '2026-10-16', amount: -5_000, note: '转出' });
    expect(added.cash_flows).toEqual([expect.objectContaining({ date: '2026-10-16', amount: -5_000, note: '转出' })]);

    const removed = removeCashFlow(added, added.cash_flows[0].id);
    expect(removed.cash_flows).toEqual([]);
    expect(() => applyCashFlow(emptyDecisionLog(), { date: '2026/10/16', amount: 100 })).toThrow('YYYY-MM-DD');
    expect(() => applyCashFlow(emptyDecisionLog(), { date: '2026-10-16', amount: 0 })).toThrow('非零');
  });

  it('存盘读盘不丢字段，坏文件退回空日志', async () => {
    const dir = await root();
    const store = captureNav(captureTrades(emptyDecisionLog(), snapshot, { now: new Date('2026-10-16T08:00:00Z'), channelReview }), snapshot, { date: '2026-10-16' });
    await writeDecisionLog(dir, store);

    expect(await readDecisionLog(dir)).toEqual(store);
    expect(await readDecisionLog(await root())).toEqual(emptyDecisionLog());
  });

  it('写接口只认同源 + 自定义头 + JSON，这不是身份认证', () => {
    const headers = { origin: 'https://www.myopenid.top', host: 'www.myopenid.top', 'x-decision-log': '1', 'content-type': 'application/json' };
    expect(sameSiteWrite({ headers })).toBe(true);
    expect(sameSiteWrite({ headers: { ...headers, origin: 'https://evil.example' } })).toBe(false);
    expect(sameSiteWrite({ headers: { ...headers, 'x-decision-log': undefined } })).toBe(false);
    expect(sameSiteWrite({ headers: { ...headers, 'content-type': 'text/plain' } })).toBe(false);
  });
});

describe('决策日志接口', () => {
  function harness(dir: string) {
    const sent: { status: number; body: unknown }[] = [];
    const route = createDecisionLogRoute({
      root: dir,
      sendJson: (_res: unknown, status: number, body: unknown) => sent.push({ status, body }),
      readBody: async (req: { body?: string }) => Buffer.from(req.body ?? '{}'),
      now: () => new Date('2026-10-16T09:00:00Z'),
    });
    const call = (method: string, pathname: string, body?: unknown, headers: Record<string, unknown> = {}) => route(
      new URL(`http://127.0.0.1${pathname}`),
      {
        method,
        headers: {
          origin: 'https://www.myopenid.top', host: 'www.myopenid.top',
          'x-decision-log': '1', 'content-type': 'application/json', ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      {},
    );
    return { sent, call };
  }

  it('GET 返回空日志；非本站的写请求一律 403', async () => {
    const dir = await root();
    const { sent, call } = harness(dir);

    expect(await call('GET', '/api/portfolio/decision-log')).toBe(true);
    expect(sent[0]).toEqual({ status: 200, body: { log: emptyDecisionLog() } });

    await call('POST', '/api/portfolio/decision-log/cash-flows', { date: '2026-10-16', amount: 100 }, { origin: 'https://evil.example' });
    expect(sent[1].status).toBe(403);
    await call('POST', '/api/portfolio/decision-log/cash-flows', { date: '2026-10-16', amount: 100 }, { 'x-decision-log': undefined });
    expect(sent[2].status).toBe(403);
  });

  it('补填预判、加出入金、删出入金，都落盘', async () => {
    const dir = await root();
    await writeDecisionLog(dir, captureTrades(emptyDecisionLog(), snapshot, { now: new Date('2026-10-16T08:00:00Z'), channelReview }));
    const stored = await readDecisionLog(dir);
    const tradeId = stored.trades.find((trade) => trade.symbol === 'TSLA')!.id;
    const { sent, call } = harness(dir);

    await call('PUT', `/api/portfolio/decision-log/trades/${tradeId}`, {
      revision: stored.revision, trigger: ['drawdown'], note: '回撤到位', prediction: { type: 'beat_qqq', horizon_months: 3 },
    });
    expect(sent[0].status).toBe(200);
    const afterNote = await readDecisionLog(dir);
    expect(afterNote.trades.find((trade) => trade.id === tradeId)).toMatchObject({
      trigger: ['drawdown'], status: 'in_progress', prediction: { type: 'beat_qqq', horizon_months: 3, reference_symbol: 'QQQ' },
    });

    await call('POST', '/api/portfolio/decision-log/cash-flows', { revision: afterNote.revision, date: '2026-10-16', amount: 10_000 });
    expect(sent[1].status).toBe(200);
    const afterFlow = await readDecisionLog(dir);
    expect(afterFlow.cash_flows).toHaveLength(1);

    await call('DELETE', `/api/portfolio/decision-log/cash-flows/${afterFlow.cash_flows[0].id}`, undefined, { 'content-type': undefined });
    expect(sent[2].status).toBe(200);
    expect((await readDecisionLog(dir)).cash_flows).toEqual([]);
  });

  it('版本号过期返回 409，并把服务器上的最新日志带回去', async () => {
    const dir = await root();
    await writeDecisionLog(dir, applyCashFlow(emptyDecisionLog(), { date: '2026-10-15', amount: 1 }));
    const { sent, call } = harness(dir);

    await call('POST', '/api/portfolio/decision-log/cash-flows', { revision: 0, date: '2026-10-16', amount: 2 });
    expect(sent[0].status).toBe(409);
    expect((sent[0].body as { log: { cash_flows: unknown[] } }).log.cash_flows).toHaveLength(1);
  });

  it('手动补录过去的交易，重复补录会被拒绝', async () => {
    const dir = await root();
    const { sent, call } = harness(dir);

    await call('POST', '/api/portfolio/decision-log/trades', {
      trade_time: '2026-09-01T14:30:00Z', symbol: 'TQQQ', side: 'BUY', qty: 100, price: 80, note: '回撤 11% 买入',
    });
    expect(sent[0].status).toBe(200);
    const stored = await readDecisionLog(dir);
    expect(stored.trades).toEqual([expect.objectContaining({
      symbol: 'TQQQ', side: 'BUY', qty: 100, price: 80, amount: 8_000, recorded_by: 'manual', status: 'pending_note',
    })]);
    expect(stored.trades[0].indicators.cnn_fear_greed).toBeNull();

    await call('POST', '/api/portfolio/decision-log/trades', {
      revision: stored.revision, trade_time: '2026-09-01T14:30:00Z', symbol: 'TQQQ', side: 'BUY', qty: 100, price: 80,
    });
    expect(sent[1].status).toBe(400);
    expect((sent[1].body as { error: { message: string } }).error.message).toContain('已经记过');

    await call('POST', '/api/portfolio/decision-log/trades', { trade_time: '不是时间', symbol: 'TQQQ', side: 'BUY', qty: 1 });
    expect(sent[2].status).toBe(400);
  });

  it('删出入金时版本号过期也要 409', async () => {
    const dir = await root();
    await writeDecisionLog(dir, applyCashFlow(emptyDecisionLog(), { date: '2026-10-15', amount: 1 }));
    const stored = await readDecisionLog(dir);
    const { sent, call } = harness(dir);

    await call('DELETE', `/api/portfolio/decision-log/cash-flows/${stored.cash_flows[0].id}?revision=0`, undefined, { 'content-type': undefined });
    expect(sent[0].status).toBe(409);
    expect((await readDecisionLog(dir)).cash_flows).toHaveLength(1);

    await call('DELETE', `/api/portfolio/decision-log/cash-flows/${stored.cash_flows[0].id}?revision=${stored.revision}`, undefined, { 'content-type': undefined });
    expect(sent[1].status).toBe(200);
    expect((await readDecisionLog(dir)).cash_flows).toEqual([]);
  });

  it('未知路径返回 404', async () => {
    const dir = await root();
    const { sent, call } = harness(dir);

    await call('GET', '/api/portfolio/decision-log/whatever');
    expect(sent[0].status).toBe(404);
  });
});
