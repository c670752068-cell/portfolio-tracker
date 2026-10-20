import { readAlertLog, voidAlerts, writeAlertLog } from './alert-log.mjs';
import { isDustTrade, readDecisionLog, voidDustTrades, writeDecisionLog } from './decision-log.mjs';

// 一次性修旧账：券商清仓后留下的零碎股（NVDA 0.005 股 / $1.08）被当成了交易，
// 决策日志和提醒日志里各有记录。这里只加「已作废」标记并写明原因，一行都不删。
// 网关启动时跑一次，跑第二遍没有要改的就什么都不动。
export const DUST_VOID_REASON = '零碎持仓';

const DUST_TEXT = /·\s*(?:买入|卖出)\s+[A-Z][A-Z0-9.]*\s+(\d+(?:\.\d+)?)\s*[@（(]/u;

/** 决策日志里已经找不到那笔成交时，按提醒原文认出零碎持仓。 */
export function isDustHoldingsAlert(alert) {
  if (!String(alert?.dedupe_key || '').startsWith('holdings:')) return false;
  const match = DUST_TEXT.exec(String(alert?.text || ''));
  if (!match) return false;
  const qty = Number(match[1]);
  return Number.isFinite(qty) && qty > 0 && qty < 1;
}

export async function voidDustRecords(root, { now = new Date() } = {}) {
  const decision = await readDecisionLog(root);
  const dustKeys = decision.trades.filter((trade) => trade.voided !== true && isDustTrade(trade))
    .map((trade) => `holdings:${trade.key}`);
  const nextDecision = voidDustTrades(decision, { reason: DUST_VOID_REASON, now });
  const trades = nextDecision === decision ? 0 : dustKeys.length;
  if (trades > 0) await writeDecisionLog(root, nextDecision);

  const store = await readAlertLog(root);
  const textMatched = store.alerts.filter((item) => item.voided !== true && isDustHoldingsAlert(item))
    .map((item) => item.dedupe_key);
  const dedupeKeys = [...new Set([...dustKeys, ...textMatched])];
  const nextStore = voidAlerts(store, { dedupeKeys, reason: DUST_VOID_REASON }, now);
  const alerts = nextStore === store
    ? 0
    : nextStore.alerts.filter((item) => item.voided === true && item.voided_at === now.toISOString()).length;
  if (nextStore !== store) await writeAlertLog(root, nextStore);
  return { trades, alerts };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] || '/opt/portfolio-tracker-data/alerts';
  voidDustRecords(root)
    .then((summary) => console.log(`voided dust records: ${summary.trades} trades, ${summary.alerts} alerts`))
    .catch((error) => {
      console.error(`void dust records failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
