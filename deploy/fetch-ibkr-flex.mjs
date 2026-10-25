#!/usr/bin/env node
// 手动跑一次 IBKR Flex 取数，确认 token 和查询编号填对了。
// 用法：node fetch-ibkr-flex.mjs [配置文件路径]
// 默认读 /opt/portfolio-tracker-data/ibkr-flex.config.json；不写任何文件，只打印结果。
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fetchIbkrFlexPositions } from './ibkr-flex.mjs';

const DEFAULT_CONFIG = '/opt/portfolio-tracker-data/ibkr-flex.config.json';

async function main() {
  const path = process.argv[2] || DEFAULT_CONFIG;
  let config;
  try {
    config = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    console.error(`读不到配置：${path}`);
    console.error('把 deploy/ibkr-flex.config.template.json 复制过去，填上 token 和查询编号，权限设成 600。');
    process.exitCode = 2;
    return;
  }
  if (String(config.token || '').includes('<<<') || !config.token) {
    console.error('配置里的 token 还没填（还是占位符）。');
    process.exitCode = 2;
    return;
  }
  const result = await fetchIbkrFlexPositions({
    token: config.token,
    queryId: config.positionsQueryId,
    get: async (url) => {
      const response = await fetch(url, { headers: { 'User-Agent': 'portfolio-tracker' } });
      return response.text();
    },
  });
  if (!result.ok) {
    console.error(`取数失败：${result.reason}${result.errorMessage ? ` · ${result.errorMessage}` : ''}`);
    process.exitCode = 1;
    return;
  }
  console.log(`账户 ${result.accountId} · 对账日 ${result.asOf} · ${result.positions.length} 条持仓`);
  for (const item of result.positions.slice(0, 20)) {
    console.log(`  ${item.symbol.padEnd(22)} ${String(item.qty).padStart(8)}  ${item.assetType}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`出错：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
