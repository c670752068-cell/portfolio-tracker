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
