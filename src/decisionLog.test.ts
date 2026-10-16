import { afterEach, describe, expect, it, vi } from 'vitest';
import { addCashFlow, addManualTrade, fetchDecisionLog, removeCashFlow, saveTradeNote } from './decisionLog';

afterEach(() => vi.unstubAllGlobals());

function stubOk(payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const log = { version: 1, revision: 3, updated_at: null, trades: [], nav_series: [], cash_flows: [] };

describe('决策日志客户端', () => {
  it('读日志走 GET，不带写入头', async () => {
    const fetchMock = stubOk({ log });

    expect(await fetchDecisionLog('/api/portfolio/decision-log')).toEqual(log);
    expect(fetchMock).toHaveBeenCalledWith('/api/portfolio/decision-log', { cache: 'no-store', signal: undefined });
  });

  it('补填预判带上 revision 和自定义写入头', async () => {
    const fetchMock = stubOk({ log });

    await saveTradeNote('/api/portfolio/decision-log', 'trade-1', {
      trigger: ['drawdown'], note: '回撤到位', prediction: { type: 'beat_qqq', horizon_months: 3 },
    }, 3);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/portfolio/decision-log/trades/trade-1');
    expect(init.method).toBe('PUT');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', 'X-Decision-Log': '1' });
    expect(JSON.parse(init.body)).toEqual({
      revision: 3, trigger: ['drawdown'], note: '回撤到位', prediction: { type: 'beat_qqq', horizon_months: 3 },
    });
  });

  it('出入金可以加和删', async () => {
    const fetchMock = stubOk({ log });
    await addCashFlow('/api/portfolio/decision-log', { date: '2026-10-16', amount: -5_000, note: '转出' }, 3);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/portfolio/decision-log/cash-flows');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ revision: 3, date: '2026-10-16', amount: -5_000, note: '转出' });

    await removeCashFlow('/api/portfolio/decision-log', 'flow-1', 4);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/portfolio/decision-log/cash-flows/flow-1?revision=4');
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
  });

  it('手动补录过去的交易', async () => {
    const fetchMock = stubOk({ log });

    await addManualTrade('/api/portfolio/decision-log', {
      trade_time: '2026-09-01T14:30:00Z', symbol: 'tqqq', side: 'BUY', qty: 100, price: 80,
    }, 3);

    expect(fetchMock.mock.calls[0][0]).toBe('/api/portfolio/decision-log/trades');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      revision: 3, trade_time: '2026-09-01T14:30:00Z', symbol: 'TQQQ', side: 'BUY', qty: 100, price: 80,
    });
  });

  it('服务器报错时把中文消息抛出来；409 带回服务器最新日志', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: '回调幅度要在 0～90% 之间' } }), { status: 400 },
    )));
    await expect(saveTradeNote('/api/portfolio/decision-log', 'trade-1', {}, 3)).rejects.toThrow('回调幅度');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { message: '日志已在别处修改，请刷新后重试' }, log: { ...log, revision: 9 } }), { status: 409 },
    )));
    await expect(saveTradeNote('/api/portfolio/decision-log', 'trade-1', {}, 3)).rejects.toMatchObject({
      message: expect.stringContaining('刷新'),
      log: { revision: 9 },
    });
  });
});
