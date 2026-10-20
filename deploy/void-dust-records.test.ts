import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readAlertLog, writeAlertLog, emptyAlertLog } from './alert-log.mjs';
import { readDecisionLog, writeDecisionLog, emptyDecisionLog } from './decision-log.mjs';
import { DUST_VOID_REASON, isDustHoldingsAlert, voidDustRecords } from './void-dust-records.mjs';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function root() {
  const value = await mkdtemp(join(tmpdir(), 'void-dust-'));
  roots.push(value);
  return value;
}

const dustTrade = {
  id: 'trade-dust', key: 'FUTU|NVDA|BUY|0.005|2026-10-20T06:46:12.000000-04:00',
  trade_time: '2026-10-20T06:46:12.000000-04:00', recorded_by: 'position_ledger',
  symbol: 'NVDA', side: 'BUY', asset_type: 'stock', broker: 'FUTU', qty: 0.005, price: 216,
  amount: 1.08, status: 'pending_note', trigger: [], prediction: null, note: '',
};
const realTrade = { ...dustTrade, id: 'trade-real', key: 'IBKR|TSLA|BUY|17|2026-10-13T00:37:24-04:00', symbol: 'TSLA', qty: 17, price: 380.29, amount: 6464.93 };

describe('把零碎持仓的旧记录标成已作废', () => {
  it('决策日志里的零碎成交和对应的提醒都标已作废，一行都不删', async () => {
    const dir = await root();
    await writeDecisionLog(dir, { ...emptyDecisionLog(), trades: [dustTrade, realTrade] });
    await writeAlertLog(dir, {
      ...emptyAlertLog(),
      alerts: [
        {
          id: 'alert-1', dedupe_key: `holdings:${dustTrade.key}`, category: 'position', symbol: 'NVDA',
          occurred_at: '2026-10-20T10:46:12.000Z', icon: '🧾',
          text: 'FUTU · 买入 NVDA 0.005 @ $216.00 · 已同步到决策日志，待补充理由',
        },
        {
          id: 'alert-2', dedupe_key: `holdings:${realTrade.key}`, category: 'position', symbol: 'TSLA',
          occurred_at: '2026-10-13T04:37:24.000Z', icon: '🧾',
          text: 'IBKR · 买入 TSLA 17 @ $380.29 · 已同步到决策日志，待补充理由',
        },
      ],
    });

    const summary = await voidDustRecords(dir, { now: new Date('2026-10-20T12:00:00Z') });
    expect(summary).toEqual({ trades: 1, alerts: 1 });

    const decision = await readDecisionLog(dir);
    expect(decision.trades).toHaveLength(2);
    expect(decision.trades.find((trade) => trade.id === 'trade-dust')).toMatchObject({
      voided: true, voided_reason: DUST_VOID_REASON,
    });
    expect(decision.trades.find((trade) => trade.id === 'trade-real')!.voided).toBeUndefined();

    const alerts = await readAlertLog(dir);
    expect(alerts.alerts).toHaveLength(2);
    expect(alerts.alerts.find((item) => item.id === 'alert-1')).toMatchObject({
      voided: true, voided_reason: DUST_VOID_REASON,
    });
    expect(alerts.alerts.find((item) => item.id === 'alert-2')!.voided).toBeUndefined();
  });

  it('决策日志里已经没有那笔成交时，按提醒原文认出零碎持仓', () => {
    expect(isDustHoldingsAlert({
      dedupe_key: 'holdings:FUTU|NVDA|BUY|0.005|x',
      text: 'FUTU · 买入 NVDA 0.005 @ $216.00 · 已同步到决策日志，待补充理由',
    })).toBe(true);
    expect(isDustHoldingsAlert({
      dedupe_key: 'holdings:FUTU|NVDA|SELL|0.005|x',
      text: 'FUTU · 卖出 NVDA 0.005（价格待补） · 已同步到决策日志，待补充理由',
    })).toBe(true);
    expect(isDustHoldingsAlert({
      dedupe_key: 'holdings:IBKR|TSLA|BUY|17|x',
      text: 'IBKR · 买入 TSLA 17 @ $380.29 · 已同步到决策日志，待补充理由',
    })).toBe(false);
    // 不是持仓变化的提醒一律不碰
    expect(isDustHoldingsAlert({ dedupe_key: 'z-cross:UDOW:0.5:up:2026-10-20', text: '· 买入 X 0.005 ·' })).toBe(false);
  });

  it('跑第二遍没有要改的，不再改写文件', async () => {
    const dir = await root();
    await writeDecisionLog(dir, { ...emptyDecisionLog(), trades: [dustTrade] });
    await writeAlertLog(dir, emptyAlertLog());

    expect(await voidDustRecords(dir, { now: new Date('2026-10-20T12:00:00Z') })).toEqual({ trades: 1, alerts: 0 });
    expect(await voidDustRecords(dir, { now: new Date('2026-10-20T13:00:00Z') })).toEqual({ trades: 0, alerts: 0 });
  });
});
