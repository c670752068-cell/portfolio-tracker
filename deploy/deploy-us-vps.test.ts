import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('US VPS deployment bundle', () => {
  it('uploads every local module imported by the gateway entry point', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');

    expect(script).toContain(
      'deploy/refresh-request-route.mjs "${SERVER}:${REMOTE_RELEASE_APP}/refresh-request-route.mjs"',
    );
    expect(script).toContain(
      'deploy/market-session.mjs "${SERVER}:${REMOTE_RELEASE_APP}/market-session.mjs"',
    );
    expect(script).toContain(
      'deploy/yahoo-quote.mjs "${SERVER}:${REMOTE_RELEASE_APP}/yahoo-quote.mjs"',
    );
    expect(script).toContain(
      'deploy/channel-review.mjs "${SERVER}:${REMOTE_RELEASE_APP}/channel-review.mjs"',
    );
    expect(script).toContain('deploy/notification-control.mjs "${SERVER}:${REMOTE_RELEASE_APP}/notification-control.mjs"');
    expect(script).toContain('deploy/z-breakout.mjs "${SERVER}:${REMOTE_RELEASE_APP}/z-breakout.mjs"');
    expect(script).toContain('deploy/z-extreme.mjs "${SERVER}:${REMOTE_RELEASE_APP}/z-extreme.mjs"');
  });

  it('keeps the application port private behind Nginx', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');

    expect(script).toContain('HOST=127.0.0.1');
    expect(script).not.toContain('HOST=0.0.0.0');
    expect(script).not.toContain('ufw allow 8788/tcp');
    expect(script).toContain('ufw delete allow 8788/tcp');
  });

  it('uploads a complete versioned release before atomically switching the current symlink', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');

    expect(script).toContain('REMOTE_RELEASE_ROOT=');
    expect(script).toContain('REMOTE_RELEASE_APP=');
    expect(script).toContain('REMOTE_RELEASE_WEB=');
    expect(script).toContain('ln -sfn');
    expect(script).toContain('mv -Tf');
    expect(script.indexOf('rsync')).toBeLessThan(script.indexOf('ln -sfn'));
  });

  it('keeps the existing PM2 secret environment when switching releases', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');

    expect(script).not.toContain('pm2 delete portfolio-tracker');
    expect(script).toContain('pm2 restart portfolio-tracker');
    expect(script).toContain("REMOTE_STABLE_APP='/opt/portfolio-tracker-gateway'");
    expect(script).toContain("REMOTE_STABLE_WEB='/opt/portfolio-tracker-web'");
  });
});

describe('新增的网关模块必须一起上传', () => {
  it('上传并语法检查 sell-price-sanity.mjs（网关 import 它，漏传会起不来）', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');
    expect(script).toContain('deploy/sell-price-sanity.mjs "${SERVER}:${REMOTE_RELEASE_APP}/sell-price-sanity.mjs"');
    expect(script).toContain("node --check '${REMOTE_RELEASE_APP}/sell-price-sanity.mjs'");
  });

  it('上传并语法检查 last-good-cache.mjs', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');
    expect(script).toContain('deploy/last-good-cache.mjs "${SERVER}:${REMOTE_RELEASE_APP}/last-good-cache.mjs"');
    expect(script).toContain("node --check '${REMOTE_RELEASE_APP}/last-good-cache.mjs'");
  });

  it('行情刷新失败时网关保留上一份完整数据而不是返回 422', async () => {
    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');
    expect(gateway).toContain('maSlopeCache.lastGood(cacheKey)');
    expect(gateway).toContain('serving last complete data');
    expect(gateway).toContain('channel review kept the previous complete close');
  });
});

describe('决策日志模块上线所需', () => {
  it('上传并语法检查 decision-log.mjs', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');
    expect(script).toContain('deploy/decision-log.mjs "${SERVER}:${REMOTE_RELEASE_APP}/decision-log.mjs"');
    expect(script).toContain("node --check '${REMOTE_RELEASE_APP}/decision-log.mjs'");
  });

  it('上传并语法检查 decision-log-resolve.mjs，网关每天收盘审查后跑判定', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');
    expect(script).toContain('deploy/decision-log-resolve.mjs "${SERVER}:${REMOTE_RELEASE_APP}/decision-log-resolve.mjs"');
    expect(script).toContain("node --check '${REMOTE_RELEASE_APP}/decision-log-resolve.mjs'");

    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');
    expect(gateway).toContain("from './decision-log-resolve.mjs'");
    expect(gateway).toContain('resolveDecisionLog(');
    expect(gateway).toContain('resolveSymbols(');
  });

  it('网关挂上决策日志路由，并在量化快照上传时抓成交与每日净值', async () => {
    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');
    expect(gateway).toContain("from './decision-log.mjs'");
    expect(gateway).toContain('handleDecisionLogRoute(url, req, res)');
    expect(gateway).toContain('captureTrades(');
    expect(gateway).toContain('captureNav(');
    // 伪影可能跨两次抓取才凑成一对，所以抓完再清一遍
    expect(gateway).toContain('dropStoredSnapshotArtifacts(');
  });
});

describe('提醒日志上线所需', () => {
  it('上传并语法检查 alert-log.mjs', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');
    expect(script).toContain('deploy/alert-log.mjs "${SERVER}:${REMOTE_RELEASE_APP}/alert-log.mjs"');
    expect(script).toContain("node --check '${REMOTE_RELEASE_APP}/alert-log.mjs'");
  });

  it('网关挂上提醒日志路由，推送时同步写一行，快照上传时记回撤档位与阈值线', async () => {
    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');
    expect(gateway).toContain("from './alert-log.mjs'");
    expect(gateway).toContain('handleAlertLogRoute(url, req, res)');
    // 原有的推送都走 dispatchAndLogAlert 这个出口（推一条记一行）；
    // 实时提醒自己在 runRealtimeTick 里写日志，所以另外两处调用是它和免打扰汇总。
    expect(gateway).toContain('dispatchAndLogAlert(');
    expect(gateway).toContain('notify: event => dispatchAndLogAlert(event)');
    expect(gateway.match(/notificationControl\.dispatch\(/g)).toHaveLength(3);
    expect(gateway).toContain('qqqDrawdownEvents(');
    expect(gateway).toContain('applyStateAlerts(');
  });
});

describe('实时监控上线所需', () => {
  it('三个实时模块都要上传并语法检查', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');
    for (const name of ['realtime-alerts', 'realtime-push', 'realtime-monitor']) {
      expect(script).toContain(`deploy/${name}.mjs "\${SERVER}:\${REMOTE_RELEASE_APP}/${name}.mjs"`);
      expect(script).toContain(`node --check '\${REMOTE_RELEASE_APP}/${name}.mjs'`);
    }
  });

  it('网关常驻实时监控，按时段节奏跑，并把持仓变化写进提醒日志', async () => {
    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');
    expect(gateway).toContain('runRealtimeMonitorCycle');
    expect(gateway).toContain('setInterval(runRealtimeMonitorCycle');
    expect(gateway).toContain('SESSION_CADENCE_MS');
    expect(gateway).toContain('inQuietHours(settings, now)');
    expect(gateway).toContain('quietSummaryEvent(');
    expect(gateway).toContain("icon: '🧾'");
  });
});

describe('实时卖出线也要过合理性校验', () => {
  it('网关把卖出方案先过一遍 saneSellPricePlan 再拿来比价', async () => {
    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');
    const block = gateway.slice(gateway.indexOf('const sellLines = {}'), gateway.indexOf('const cnnScore'));

    expect(block).toContain('saneSellPricePlan(');
    expect(block).not.toMatch(/const trigger = Number\(plan\.trigger_price \?\? plan\.sell_price\);/);
  });
});

describe('数据源中断提醒接进网关', () => {
  it('轮询里记录最近一次成功取价，并按状态变化写系统提醒', async () => {
    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');

    expect(gateway).toContain('feedStateReading(');
    expect(gateway).toContain('lastQuoteOkAt');
  });
});

describe('第三阶段实测问题的网关接线', () => {
  it('实时卖出线把基准价一起交给判定，用的是卖出页同一套校验', async () => {
    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');

    expect(gateway).toMatch(/sellLines\[symbol\] = \{ trigger, reference/);
  });

  it('盘中 Z 用决策页「盘中预览」的读数，范围不再砍到 8 个', async () => {
    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');

    expect(gateway).toContain('intradayZPreview(');
    expect(gateway).not.toContain('intradayZFromDashboard');
    expect(gateway).not.toContain("['QQQ', ...held].slice(0, 8)");
  });

  it('CNN 读数不把空值当 0，并从日志里取最近一次已知值做起点', async () => {
    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');

    expect(gateway).not.toMatch(/const cnnScore = Number\(snapshot\?\.context\?\.cnn_fear_greed\?\.score\)/);
    expect(gateway).toContain('lastKnownCnnScore(');
  });

  it('回填的收盘时间按美东 16:30 换算，冬令时不再写成 20:30Z', async () => {
    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');

    expect(gateway).not.toContain('T20:30:00.000Z');
    expect(gateway).toContain('etCloseInstant(');
  });

  it('推送日志记下真实状态和标的、时段', async () => {
    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');

    expect(gateway).toContain('push_state:');
    expect(gateway).toContain('symbolFromEventKey(');
  });
});

describe('休市重复、净值和推送重试的网关接线', () => {
  it('实时轮询用交易日去重，不用日历日期', async () => {
    const monitor = await readFile('deploy/realtime-monitor.mjs', 'utf8');

    expect(monitor).toContain('tradingDate(now)');
    expect(monitor).not.toContain('etDay(now)');
  });

  it('推送失败有重试任务在跑，结果回填到日志', async () => {
    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');

    expect(gateway).toContain('retryPending(');
    expect(gateway).toContain('setPushState(');
    expect(gateway).toContain('PUSH_RETRY_TICK_MS');
  });
});

describe('持仓市值实时估算的接线', () => {
  it('上传并语法检查 position-estimate.mjs', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');
    expect(script).toContain('deploy/position-estimate.mjs "${SERVER}:${REMOTE_RELEASE_APP}/position-estimate.mjs"');
    expect(script).toContain("node --check '${REMOTE_RELEASE_APP}/position-estimate.mjs'");
  });

  it('持仓接口用实时报价缓存重算市值，报价来自实时轮询、不另外抓', async () => {
    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');

    expect(gateway).toContain('estimatePositionValues(');
    expect(gateway).toContain('LIVE_QUOTES');
  });

  it('净值序列的日期用券商自己的 as_of，不用抓取时间', async () => {
    const log = await readFile('deploy/decision-log.mjs', 'utf8');

    expect(log).toContain('navAsOfDate(');
    expect(log).toContain('freshness.positions_as_of');
    expect(log).not.toContain('navTradingDate');
  });
});

describe('提醒降噪上线所需', () => {
  it('降噪模块和它的配置文件都要上传，模块还要语法检查', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');
    expect(script).toContain('deploy/alert-noise.mjs "${SERVER}:${REMOTE_RELEASE_APP}/alert-noise.mjs"');
    expect(script).toContain("node --check '${REMOTE_RELEASE_APP}/alert-noise.mjs'");
    expect(script).toContain('deploy/alert-noise.config.json "${SERVER}:${REMOTE_RELEASE_APP}/alert-noise.config.json"');
  });

  it('网关用降噪模块写定时提醒，并把冷却时间传给实时监控', async () => {
    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');
    expect(gateway).toContain('planSlotEntries(');
    expect(gateway).toContain('cooldownMs:');
    expect(gateway).toContain('loadNoiseConfig(');
  });

  it('修旧账的脚本要上传，网关启动时跑一次', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');
    expect(script).toContain('deploy/void-dust-records.mjs "${SERVER}:${REMOTE_RELEASE_APP}/void-dust-records.mjs"');
    expect(script).toContain("node --check '${REMOTE_RELEASE_APP}/void-dust-records.mjs'");
    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');
    expect(gateway).toContain('voidDustRecords(PORTFOLIO_ALERTS_ROOT)');
  });

  it('冷却时间写在配置文件里，不做成界面开关', async () => {
    const config = JSON.parse(await readFile('deploy/alert-noise.config.json', 'utf8'));
    expect(config.cooldownMinutes).toBe(60);
    expect(config.importantBypassesCooldown).toBe(true);
  });
});

describe('提醒效果上线所需', () => {
  it('效果统计模块要上传并语法检查', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');
    expect(script).toContain('deploy/alert-outcomes.mjs "${SERVER}:${REMOTE_RELEASE_APP}/alert-outcomes.mjs"');
    expect(script).toContain("node --check '${REMOTE_RELEASE_APP}/alert-outcomes.mjs'");
  });

  it('网关每天收盘审查之后算一次，并提供只读接口', async () => {
    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');
    expect(gateway).toContain('runAlertOutcomesCycle');
    expect(gateway).toContain('await runAlertOutcomesCycle();');
    expect(gateway).toContain('handleAlertOutcomesRoute');
  });

  it('刚上线时先修参考价旧账，再补算一份效果统计', async () => {
    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');
    expect(gateway).toContain('await runReferencePriceFixCycle();');
    expect(gateway).toContain('await runAlertOutcomesCycle();');
    expect(gateway.indexOf('await runReferencePriceFixCycle();'))
      .toBeLessThan(gateway.lastIndexOf('await runAlertOutcomesCycle();'));
  });

  it('修旧账那一轮不能因为没有要重算的行情就早退', async () => {
    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');
    const cycle = gateway.slice(
      gateway.indexOf('async function runReferencePriceFixCycle'),
      gateway.indexOf('// 提醒效果平时跟着每天的收盘审查算'),
    );
    // Z 措辞和「按新阈值不再提醒」不需要行情，取不到标的也要继续跑
    expect(cycle).not.toContain('if (symbols.length === 0) return;');
    expect(cycle).toContain('applyReferencePriceFixes(');
  });

  it('修参考价的模块要上传并语法检查', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');
    expect(script).toContain('deploy/fix-reference-price-alerts.mjs "${SERVER}:${REMOTE_RELEASE_APP}/fix-reference-price-alerts.mjs"');
    expect(script).toContain("node --check '${REMOTE_RELEASE_APP}/fix-reference-price-alerts.mjs'");
  });
});

describe('券商同步提醒上线所需', () => {
  it('模块要上传、语法检查，并接进快照处理', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');
    expect(script).toContain('deploy/broker-health.mjs "${SERVER}:${REMOTE_RELEASE_APP}/broker-health.mjs"');
    expect(script).toContain("node --check '${REMOTE_RELEASE_APP}/broker-health.mjs'");

    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');
    expect(gateway).toContain('brokerHealthReadings(snapshot)');
  });
});

describe('三大指数卡片上线所需', () => {
  it('模块要上传、语法检查，并接上只读路由', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');
    expect(script).toContain('deploy/index-quotes.mjs "${SERVER}:${REMOTE_RELEASE_APP}/index-quotes.mjs"');
    expect(script).toContain("node --check '${REMOTE_RELEASE_APP}/index-quotes.mjs'");

    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');
    expect(gateway).toContain('createIndexQuotesCache(');
    expect(gateway).toContain('handleIndexQuotesRoute');
  });
});

describe('夜盘行情上线所需', () => {
  it('两个新模块要上传并语法检查', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');
    for (const name of ['overnight-quotes', 'quote-freshness', 'portfolio-loss']) {
      expect(script).toContain(`deploy/${name}.mjs "\${SERVER}:\${REMOTE_RELEASE_APP}/${name}.mjs"`);
      expect(script).toContain(`node --check '\${REMOTE_RELEASE_APP}/${name}.mjs'`);
    }
  });

  it('网关按时段取价、接收夜盘推送、并判断价格是否过期', async () => {
    const gateway = await readFile('deploy/aliyun-gateway.mjs', 'utf8');
    expect(gateway).toContain('fetchSessionQuote(');
    expect(gateway).toContain('handleOvernightQuotesRoute');
    expect(gateway).toContain('markQuoteFreshness(');
    expect(gateway).toContain('feedOutageReading(');
    // 实时监控在夜盘也要取价（不能再只在有交易时段时跑）
    expect(gateway).toContain("session === 'overnight'");
  });
});

