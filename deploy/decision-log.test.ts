import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DUST_MARKET_VALUE_USD, DUST_MINIMUM_SHARES, addManualTrade, applyCashFlow, applyTradeNote, captureNav,
  captureTrades, clearTrades, createDecisionLogRoute, dropStoredSnapshotArtifacts, emptyDecisionLog,
  isDustTrade, readDecisionLog, removeCashFlow, sameSiteWrite, tradeKey, voidDustTrades, writeDecisionLog,
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
        asset_type: 'stock', broker: 'FUTU', side: 'SELL', symbol: 'NVDA', quantity: 5,
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
    expect(updated.amount).toBeCloseTo(1140, 2);
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

describe('快照伪影过滤', () => {
  // 线上实测：量化侧某次把持仓读空，差分出「全部卖出」，4 秒后恢复又差分出「全部买回」。
  const artifactEvents = [
    { broker: 'IBKR', symbol: 'TSLA', side: 'SELL', quantity: 17, price: null, price_source: 'unavailable', estimated: true, asset_type: 'stock', recorded_at: '2026-10-11T20:26:13.000-04:00' },
    { broker: 'IBKR', symbol: 'AVGO', side: 'SELL', quantity: 40, price: null, price_source: 'unavailable', estimated: true, asset_type: 'stock', recorded_at: '2026-10-11T20:26:13.000-04:00' },
    { broker: 'IBKR', symbol: 'TSLA', side: 'BUY', quantity: 17, price: 380.29, price_source: 'broker_cost_delta', estimated: false, asset_type: 'stock', recorded_at: '2026-10-11T20:26:17.000-04:00' },
    { broker: 'IBKR', symbol: 'AVGO', side: 'BUY', quantity: 40, price: 354.1, price_source: 'broker_cost_delta', estimated: false, asset_type: 'stock', recorded_at: '2026-10-11T20:26:17.000-04:00' },
  ];

  it('同标的同数量、方向相反、10 分钟内的两条都不入日志', () => {
    const store = captureTrades(emptyDecisionLog(), { position_ledger: { recent_events: artifactEvents } }, {
      now: new Date('2026-10-16T08:00:00Z'),
    });

    expect(store.trades).toEqual([]);
    expect(store.revision).toBe(0);
  });

  it('间隔超过 10 分钟的来回算真交易，照常入账', () => {
    const real = [
      { ...artifactEvents[0], recorded_at: '2026-10-11T20:00:00.000-04:00' },
      { ...artifactEvents[2], recorded_at: '2026-10-11T20:11:00.000-04:00' },
    ];
    const store = captureTrades(emptyDecisionLog(), { position_ledger: { recent_events: real } }, {
      now: new Date('2026-10-16T08:00:00Z'),
    });

    expect(store.trades.map((trade) => [trade.symbol, trade.side])).toEqual([['TSLA', 'SELL'], ['TSLA', 'BUY']]);
  });

  it('数量不同或标的不同都不算伪影', () => {
    const mixed = [
      artifactEvents[0],
      { ...artifactEvents[2], quantity: 10 },
      { ...artifactEvents[1], symbol: 'MCD' },
    ];
    const store = captureTrades(emptyDecisionLog(), { position_ledger: { recent_events: mixed } }, {
      now: new Date('2026-10-16T08:00:00Z'),
    });

    expect(store.trades).toHaveLength(3);
  });

  it('一买一卖只抵消一对，多出来的那条留下', () => {
    const triple = [
      artifactEvents[0],
      { ...artifactEvents[0], recorded_at: '2026-10-11T20:26:14.000-04:00' },
      artifactEvents[2],
    ];
    const store = captureTrades(emptyDecisionLog(), { position_ledger: { recent_events: triple } }, {
      now: new Date('2026-10-16T08:00:00Z'),
    });

    expect(store.trades.map((trade) => trade.side)).toEqual(['SELL']);
  });

  it('清理已经存进去的伪影，但不碰填过理由的和手动补录的', async () => {
    const stored = captureTrades(emptyDecisionLog(), { position_ledger: { recent_events: artifactEvents } }, {
      now: new Date('2026-10-16T08:00:00Z'), keepArtifacts: true,
    });
    expect(stored.trades).toHaveLength(4);

    const annotated = applyTradeNote(stored, stored.trades[0].id, { note: '这条我写过理由' }, new Date('2026-10-16T09:00:00Z'));
    const manual = addManualTrade(annotated, {
      trade_time: '2026-10-11T20:26:13.000-04:00', symbol: 'AVGO', side: 'SELL', qty: 40,
    }, new Date('2026-10-16T09:10:00Z'));

    const cleaned = dropStoredSnapshotArtifacts(manual, new Date('2026-10-16T10:00:00Z'));

    const kept = cleaned.trades.map((trade) => `${trade.symbol}|${trade.side}|${trade.recorded_by}`);
    expect(kept).toContain('TSLA|SELL|position_ledger');
    expect(kept).toContain('AVGO|SELL|manual');
    expect(kept).not.toContain('AVGO|SELL|position_ledger');
    expect(cleaned.revision).toBe(manual.revision + 1);
  });

  it('没有伪影可清时原样返回', () => {
    const store = captureTrades(emptyDecisionLog(), { position_ledger: { recent_events: [artifactEvents[0]] } }, {
      now: new Date('2026-10-16T08:00:00Z'),
    });

    expect(dropStoredSnapshotArtifacts(store, new Date('2026-10-16T10:00:00Z'))).toBe(store);
  });
});

describe('整批读空伪影', () => {
  // 线上实测：2026-10-12 20:02:54 一次把 11 个标的整仓卖出、全部没有成交价，
  // 4 小时 35 分后 2026-10-13 00:37:24 又全部买回。
  const sellAt = '2026-10-12T20:02:54.000-04:00';
  const buyAt = '2026-10-13T00:37:24.000-04:00';
  const batch = [
    ['TSLA', 17], ['MCD', 15], ['AVL', 50], ['AVGO', 40], ['PDD', 1],
    ['NKE', 2], ['NKE', 3], ['MCD', 1], ['UDOW', 170], ['TSLL', 230], ['NAIL', 60], ['GDX', 26], ['FAS', 35],
  ] as [string, number][];
  const sells = batch.map(([symbol, quantity]) => ({
    broker: 'IBKR', symbol, side: 'SELL', quantity, price: null, price_source: 'unavailable',
    estimated: true, asset_type: 'stock', recorded_at: sellAt,
  }));
  const buys = batch.map(([symbol, quantity]) => ({
    broker: 'IBKR', symbol, side: 'BUY', quantity, price: 100 + quantity, price_source: 'broker_cost_delta',
    estimated: false, asset_type: 'stock', recorded_at: buyAt,
  }));

  it('同一时间戳 5 个以上标的整仓卖出且都没成交价，连对应的买回一起不入日志', () => {
    const store = captureTrades(emptyDecisionLog(), { position_ledger: { recent_events: [...sells, ...buys] } }, {
      now: new Date('2026-10-16T08:00:00Z'),
    });

    expect(store.trades).toEqual([]);
  });

  it('只有三个标的的批次不算读空，照常入账', () => {
    const small = sells.slice(0, 3);
    const store = captureTrades(emptyDecisionLog(), { position_ledger: { recent_events: small } }, {
      now: new Date('2026-10-16T08:00:00Z'),
    });

    expect(store.trades).toHaveLength(3);
  });

  it('批次里只要有一条带成交价，就不当读空处理', () => {
    const withPrice = [...sells];
    withPrice[0] = { ...withPrice[0], price: 380.29, price_source: 'broker_cost_delta', estimated: false };
    const store = captureTrades(emptyDecisionLog(), { position_ledger: { recent_events: withPrice } }, {
      now: new Date('2026-10-16T08:00:00Z'),
    });

    expect(store.trades).toHaveLength(sells.length);
  });

  it('只清掉数量对得上的买回，数量不同的买入留下', () => {
    const changed = [...buys];
    changed[0] = { ...changed[0], quantity: 5 };
    const store = captureTrades(emptyDecisionLog(), { position_ledger: { recent_events: [...sells, ...changed] } }, {
      now: new Date('2026-10-16T08:00:00Z'),
    });

    expect(store.trades.map((trade) => [trade.symbol, trade.side, trade.qty])).toEqual([['TSLA', 'BUY', 5]]);
  });

  it('清库存时同样生效，但手动补录和填过理由的不碰', () => {
    const stored = captureTrades(emptyDecisionLog(), { position_ledger: { recent_events: [...sells, ...buys] } }, {
      now: new Date('2026-10-16T08:00:00Z'), keepArtifacts: true,
    });
    expect(stored.trades).toHaveLength(26);

    const noted = applyTradeNote(stored, stored.trades[0].id, { note: '这条我写过' }, new Date('2026-10-16T09:00:00Z'));
    const manual = addManualTrade(noted, { trade_time: sellAt, symbol: 'UDOW', side: 'SELL', qty: 170 }, new Date('2026-10-16T09:05:00Z'));

    const cleaned = dropStoredSnapshotArtifacts(manual, new Date('2026-10-16T10:00:00Z'));

    expect(cleaned.trades.filter((trade) => trade.recorded_by === 'manual')).toHaveLength(1);
    expect(cleaned.trades.filter((trade) => trade.note === '这条我写过')).toHaveLength(1);
    // 被用户写过理由的那条卖出不进清理范围，于是它对应的那笔买回也留着——
    // 宁可多留一条，也不删用户声明过的交易的对手单。
    const leftovers = cleaned.trades.filter((trade) => trade.recorded_by === 'position_ledger' && !trade.note);
    expect(leftovers).toHaveLength(1);
    expect(leftovers[0]).toMatchObject({ side: 'BUY', symbol: stored.trades[0].symbol, qty: stored.trades[0].qty });
  });
});

describe('从空白开始', () => {
  const events = [
    { broker: 'IBKR', symbol: 'TSLL', side: 'BUY', quantity: 230, price: 10.162424, price_source: 'broker_cost_delta', estimated: false, asset_type: 'etf', recorded_at: '2026-10-11T20:26:17.000-04:00' },
    { broker: 'IBKR', symbol: 'NAIL', side: 'BUY', quantity: 60, price: 38.660633, price_source: 'broker_cost_delta', estimated: false, asset_type: 'etf', recorded_at: '2026-10-11T20:26:17.000-04:00' },
  ];

  it('清空交易并记下起算点，净值和出入金不动', () => {
    const seeded = captureNav(
      captureTrades(emptyDecisionLog(), { position_ledger: { recent_events: events } }, { now: new Date('2026-10-16T08:00:00Z') }),
      { ammo_overview: { nav_usd: 185_419.71 } },
      { date: '2026-10-16' },
    );
    const withFlow = applyCashFlow(seeded, { date: '2026-10-16', amount: 100 });
    expect(withFlow.trades).toHaveLength(2);

    const cleared = clearTrades(withFlow, new Date('2026-10-16T10:00:00Z'));

    expect(cleared.trades).toEqual([]);
    expect(cleared.nav_series).toHaveLength(1);
    expect(cleared.cash_flows).toHaveLength(1);
    expect(cleared.trades_from).toBe('2026-10-12T00:26:17.000Z');
    expect(cleared.revision).toBe(withFlow.revision + 1);
  });

  it('起算点之前的成交不会再被抓回来，之后的照常入账', () => {
    const cleared = clearTrades(
      captureTrades(emptyDecisionLog(), { position_ledger: { recent_events: events } }, { now: new Date('2026-10-16T08:00:00Z') }),
      new Date('2026-10-16T10:00:00Z'),
    );

    const again = captureTrades(cleared, { position_ledger: { recent_events: events } }, { now: new Date('2026-10-16T11:00:00Z') });
    expect(again.trades).toEqual([]);
    // 没有新增就不该产生新版本
    expect(again.revision).toBe(cleared.revision);
    expect(again.trades_from).toBe(cleared.trades_from);

    const later = captureTrades(cleared, {
      position_ledger: {
        recent_events: [...events, { ...events[0], symbol: 'TQQQ', recorded_at: '2026-10-16T10:30:00.000-04:00' }],
      },
    }, { now: new Date('2026-10-16T15:00:00Z') });
    expect(later.trades.map((trade) => trade.symbol)).toEqual(['TQQQ']);
  });

  it('没有交易可清时原样返回', () => {
    const empty = emptyDecisionLog();
    expect(clearTrades(empty, new Date('2026-10-16T10:00:00Z'))).toBe(empty);
  });

  it('存盘读盘保留起算点', async () => {
    const dir = await root();
    const cleared = clearTrades(
      captureTrades(emptyDecisionLog(), { position_ledger: { recent_events: events } }, { now: new Date('2026-10-16T08:00:00Z') }),
      new Date('2026-10-16T10:00:00Z'),
    );
    await writeDecisionLog(dir, cleared);

    expect((await readDecisionLog(dir)).trades_from).toBe('2026-10-12T00:26:17.000Z');
  });
});

describe('每日净值按券商数据自己的 as_of 记', () => {
  // 日期取 freshness.positions_as_of（券商对账到哪一天），不是抓取时间。
  // 线上真实情况：10-17 抓到的快照，IBKR 的 as_of 还停在 10-15。
  const snap = (nav: number, asOf: string | null = '2026-10-15') => ({
    ammo_overview: { nav_usd: nav },
    ...(asOf === null ? {} : { freshness: { positions_as_of: asOf, data_as_of: asOf } }),
  });

  it('记在券商的 as_of 那一天，不是抓取那一天', () => {
    const store = captureNav(emptyDecisionLog(), snap(186_325.01), { now: new Date('2026-10-17T07:42:20Z') });
    expect(store.nav_series).toEqual([
      expect.objectContaining({ date: '2026-10-15', nav: 186_325.01 }),
    ]);
  });

  it('as_of 那天还没收盘就先不记', () => {
    // as_of = 当天，而现在是美东 13:15（还没到 16:30）
    const store = captureNav(emptyDecisionLog(), snap(186_325.01, '2026-10-16'), { now: new Date('2026-10-16T17:15:08Z') });
    expect(store.nav_series).toEqual([]);
  });

  it('快照没给 as_of 就不记，绝不拿抓取时间猜一个日期', () => {
    const store = captureNav(emptyDecisionLog(), snap(186_325.01, null), { now: new Date('2026-10-16T21:00:00Z') });
    expect(store.nav_series).toEqual([]);
  });

  it('as_of 不是交易日（周六）就不记', () => {
    const store = captureNav(emptyDecisionLog(), snap(186_325.01, '2026-10-17'), { now: new Date('2026-10-19T21:00:00Z') });
    expect(store.nav_series).toEqual([]);
  });

  it('同一个 as_of 反复抓也只有一条', () => {
    const first = captureNav(emptyDecisionLog(), snap(186_325.01), { now: new Date('2026-10-17T07:42:20Z') });
    const again = captureNav(first, snap(186_325.01), { now: new Date('2026-10-17T12:00:00Z') });
    const sunday = captureNav(again, snap(186_325.01), { now: new Date('2026-10-18T16:00:00Z') });

    expect(sunday.nav_series.map((point) => point.date)).toEqual(['2026-10-15']);
    expect(again.revision).toBe(first.revision);
  });

  it('as_of 往前走时中间漏掉的交易日标缺失，不拿旧数值顶上', () => {
    const thursday = captureNav(emptyDecisionLog(), snap(186_325.01, '2026-10-15'), { now: new Date('2026-10-17T07:42:20Z') });
    // 周一、周二的对账都没拿到，周三的 as_of 才上来
    const wednesday = captureNav(thursday, snap(190_000, '2026-10-21'), { now: new Date('2026-10-22T12:00:00Z') });

    expect(wednesday.nav_series).toEqual([
      expect.objectContaining({ date: '2026-10-15', nav: 186_325.01 }),
      expect.objectContaining({ date: '2026-10-16', nav: null, missing: true }),
      expect.objectContaining({ date: '2026-10-19', nav: null, missing: true }),
      expect.objectContaining({ date: '2026-10-20', nav: null, missing: true }),
      expect.objectContaining({ date: '2026-10-21', nav: 190_000 }),
    ]);
  });

  it('补上同步后缺失那天会被真实数值替掉', () => {
    const thursday = captureNav(emptyDecisionLog(), snap(186_325.01, '2026-10-15'), { now: new Date('2026-10-17T07:42:20Z') });
    const wednesday = captureNav(thursday, snap(190_000, '2026-10-21'), { now: new Date('2026-10-22T12:00:00Z') });
    const backfilled = captureNav(wednesday, snap(188_000, '2026-10-16'), { now: new Date('2026-10-22T13:00:00Z') });

    expect(backfilled.nav_series.find((point) => point.date === '2026-10-16')).toMatchObject({
      nav: 188_000, missing: false,
    });
  });
});

describe('零碎持仓不当成交易', () => {
  const dustSnapshot = {
    ...snapshot,
    position_ledger: {
      recent_events: [
        {
          asset_type: 'stock', broker: 'FUTU', side: 'BUY', symbol: 'NVDA', quantity: 0.005,
          price: 216, price_source: 'broker_cost_delta', estimated: false,
          recorded_at: '2026-10-20T06:46:12.000000-04:00',
        },
        {
          asset_type: 'stock', broker: 'IBKR', side: 'BUY', symbol: 'TSLA', quantity: 17,
          price: 380.293984, price_source: 'broker_cost_delta', estimated: false,
          recorded_at: '2026-10-13T00:37:24.190147-04:00',
        },
      ],
    },
  };

  it('阈值和持仓页一致：市值低于 $10 或不足 1 股', () => {
    expect(DUST_MARKET_VALUE_USD).toBe(10);
    expect(DUST_MINIMUM_SHARES).toBe(1);
    expect(isDustTrade({ symbol: 'NVDA', qty: 0.005, price: 216, asset_type: 'stock' })).toBe(true);
    expect(isDustTrade({ symbol: 'NVDA', qty: 0.005, price: null, asset_type: 'stock' })).toBe(true);
    expect(isDustTrade({ symbol: 'PDD', qty: 0.04, price: 81.05, asset_type: 'stock' })).toBe(true);
    expect(isDustTrade({ symbol: 'NVDA', qty: 5, price: 216, asset_type: 'stock' })).toBe(false);
    expect(isDustTrade({ symbol: 'NVDA', qty: 1, price: 216, asset_type: 'stock' })).toBe(false);
    // 期权 1 张不是零碎仓
    expect(isDustTrade({ symbol: 'NVDA', qty: 1, price: 2.5, asset_type: 'option' })).toBe(false);
  });

  it('0.005 股的残留不写进决策日志，正常成交照抓', () => {
    const store = captureTrades(emptyDecisionLog(), dustSnapshot, { now: new Date('2026-10-20T08:00:00Z') });

    expect(store.trades.map((trade) => trade.symbol)).toEqual(['TSLA']);
  });

  it('已经记进去的零碎成交只标已作废，不删除', () => {
    const recorded = captureTrades(emptyDecisionLog(), {
      ...dustSnapshot,
      position_ledger: { recent_events: [dustSnapshot.position_ledger.recent_events[0]] },
    }, { now: new Date('2026-10-20T08:00:00Z'), keepDust: true });
    expect(recorded.trades).toHaveLength(1);

    const voided = voidDustTrades(recorded, { reason: '零碎持仓', now: new Date('2026-10-20T09:00:00Z') });
    expect(voided.trades).toHaveLength(1);
    expect(voided.trades[0]).toMatchObject({
      voided: true, voided_reason: '零碎持仓', voided_at: '2026-10-20T09:00:00.000Z',
    });
    expect(voided.revision).toBe(recorded.revision + 1);

    // 再跑一次没有要改的，原样返回
    expect(voidDustTrades(voided, { reason: '零碎持仓' })).toBe(voided);
  });
});

describe('「我据此下单了」生成的草稿', () => {
  const alertDraft = {
    trade_time: '2026-10-20T13:38:55.000Z', symbol: 'UDOW', side: 'SELL' as const, draft: true,
    alert_id: 'alert-abc', alert_text: '[盘中] UDOW $67.41 · Z 0.38 → 0.52 · 涨得更多，偏强',
  };

  it('数量和价格可以先空着，并记下是哪条提醒带来的', () => {
    const store = addManualTrade(emptyDecisionLog(), alertDraft, new Date('2026-10-20T13:40:00Z'));

    expect(store.trades).toHaveLength(1);
    expect(store.trades[0]).toMatchObject({
      symbol: 'UDOW', side: 'SELL', qty: null, price: null, amount: null,
      draft: true, alert_id: 'alert-abc', recorded_by: 'manual', status: 'pending_note',
    });
    expect(store.trades[0].alert_text).toContain('UDOW');
  });

  it('同一条提醒点两次只生成一条草稿', () => {
    const store = addManualTrade(emptyDecisionLog(), alertDraft, new Date('2026-10-20T13:40:00Z'));
    expect(() => addManualTrade(store, alertDraft, new Date('2026-10-20T13:41:00Z'))).toThrow('已经记过了');
  });

  it('不是草稿时数量仍然必须大于 0', () => {
    expect(() => addManualTrade(emptyDecisionLog(), {
      trade_time: '2026-10-20T13:38:55.000Z', symbol: 'UDOW', side: 'SELL',
    })).toThrow('数量要大于 0');
    expect(() => addManualTrade(emptyDecisionLog(), { ...alertDraft, qty: 0 })).toThrow('数量要大于 0');
  });

  it('补上数量和价格之后金额才算出来，不拿空数量乘出 0', () => {
    const store = addManualTrade(emptyDecisionLog(), alertDraft, new Date('2026-10-20T13:40:00Z'));
    const id = store.trades[0].id;

    const onlyPrice = applyTradeNote(store, id, { price: 67.41 }, new Date('2026-10-20T13:45:00Z'));
    expect(onlyPrice.trades[0]).toMatchObject({ price: 67.41, qty: null, amount: null });

    const filled = applyTradeNote(onlyPrice, id, {
      qty: 30, price: 67.41, trigger: ['z_score'], prediction: { type: 'none' }, note: '按提醒减了一点',
    }, new Date('2026-10-20T13:46:00Z'));
    expect(filled.trades[0]).toMatchObject({ qty: 30, price: 67.41, status: 'in_progress' });
    expect(filled.trades[0].amount).toBeCloseTo(2022.3, 4);
  });

  it('券商抓来的成交不许改数量', () => {
    const store = captureTrades(emptyDecisionLog(), snapshot, { now: new Date('2026-10-16T08:00:00Z') });
    const broker = store.trades.find((trade) => trade.broker === 'IBKR')!;

    expect(() => applyTradeNote(store, broker.id, { qty: 999 })).toThrow('数量');
  });
});

