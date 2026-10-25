#!/usr/bin/env node
// 并行对比：把「Mac 推上来的」和「服务器自己算的」逐项比一遍，结果打印出来，
// 差异超过阈值时往提醒日志写一条「❗ 系统」。只读、不改数据、不切换数据来源。
// 用法：node compare-sources.mjs [--write-alert]
//   服务器自己算的那份放在 <数据目录>/server-analysis/latest.json，
//   还没有这个文件时直接退出（现在就是这样，因为服务器端还没登录）。
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyStateAlerts, readAlertLog, writeAlertLog } from './alert-log.mjs';
import { compareReadingForAlerts, comparePositions, compareSnapshots } from './source-compare.mjs';

const ROOT = process.env.PORTFOLIO_ALERTS_ROOT || '/opt/portfolio-tracker-data/alerts';
const POSITIONS_ROOT = process.env.PORTFOLIO_POSITIONS_ROOT || '/opt/portfolio-tracker-data/positions';
const ANALYSIS_ROOT = process.env.PORTFOLIO_ANALYSIS_ROOT || '/opt/portfolio-tracker-data/analysis';
const SERVER_ANALYSIS_ROOT = process.env.PORTFOLIO_SERVER_ANALYSIS_ROOT
  || '/opt/portfolio-tracker-data/server-analysis';

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function sideOf(positionsPayload, analysis) {
  return {
    positions: positionsPayload?.positions || [],
    nav: positionsPayload?.net_liquidation ?? analysis?.ammo_overview?.nav_usd ?? null,
    snapshot: {
      generated_at: analysis?.generated_at ?? null,
      qqq_drawdown_pct: analysis?.symbols?.QQQ?.depth_window?.current_pct == null
        ? null
        : -Number(analysis.symbols.QQQ.depth_window.current_pct),
      cnn: analysis?.context?.cnn_fear_greed?.score ?? null,
      ndx_pe: analysis?.valuation_tab?.ndx?.current_pe ?? null,
    },
  };
}

export async function compareOnce({ writeAlert = false } = {}) {
  const macPositions = (await readJson(join(POSITIONS_ROOT, 'latest.json')))?.payload || null;
  const macAnalysis = await readJson(join(ANALYSIS_ROOT, 'latest.json'));
  const serverPositions = (await readJson(join(SERVER_ANALYSIS_ROOT, 'positions.json')))?.payload || null;
  const serverAnalysis = await readJson(join(SERVER_ANALYSIS_ROOT, 'latest.json'));
  if (!serverAnalysis && !serverPositions) {
    return { ready: false, reason: '服务器端还没有自己算的数据（OpenD 还没登录）', diffs: [] };
  }
  const mac = sideOf(macPositions, macAnalysis);
  const server = sideOf(serverPositions, serverAnalysis);
  const diffs = [...comparePositions(mac.positions, server.positions), ...compareSnapshots(mac, server)];
  if (writeAlert) {
    const store = await readAlertLog(ROOT);
    const next = applyStateAlerts(store, [compareReadingForAlerts(diffs)]);
    if (next !== store) await writeAlertLog(ROOT, next);
  }
  return { ready: true, diffs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  compareOnce({ writeAlert: process.argv.includes('--write-alert') })
    .then((result) => {
      if (!result.ready) {
        console.log(result.reason);
        return;
      }
      if (result.diffs.length === 0) {
        console.log('两边一致，没有差异。');
        return;
      }
      console.log(`共 ${result.diffs.length} 项对不上：`);
      for (const item of result.diffs) {
        console.log(`  ${(item.symbol || item.field || '').padEnd(14)} ${item.kind.padEnd(18)} Mac=${item.mac} 服务器=${item.server}`);
      }
    })
    .catch((error) => {
      console.error(`对比失败：${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
