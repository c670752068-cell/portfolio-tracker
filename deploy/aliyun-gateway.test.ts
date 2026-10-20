import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const AUTHORIZATION = 'Bearer unit-secret';
let child: ChildProcess;
let origin: string;
let storageRoot: string;
let refreshRequestPath: string;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitUntilReady(url: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      // Process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('gateway did not start');
}

beforeAll(async () => {
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  storageRoot = await mkdtemp(join(tmpdir(), 'portfolio-positions-'));
  refreshRequestPath = join(storageRoot, 'refresh-request.json');
  child = spawn(process.execPath, ['deploy/aliyun-gateway.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      PORTFOLIO_SYNC_TOKEN: 'unit-secret',
      PORTFOLIO_POSITIONS_ROOT: storageRoot,
      PORTFOLIO_ANALYSIS_ROOT: join(storageRoot, 'analysis'),
      PORTFOLIO_ALERTS_ROOT: join(storageRoot, 'alerts'),
      PORTFOLIO_REFRESH_REQUEST_PATH: refreshRequestPath,
    },
    stdio: 'ignore',
  });
  await waitUntilReady(origin);
});

afterAll(async () => {
  child.kill('SIGTERM');
  await rm(storageRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(refreshRequestPath, { force: true });
});

describe('portfolio positions gateway', () => {
  it('returns idle before any refresh request exists', async () => {
    const response = await fetch(`${origin}/api/refresh-request`, {
      headers: { Authorization: AUTHORIZATION },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'idle' });
  });

  it('stores a pending refresh request and returns it to the Mac poller', async () => {
    const post = await fetch(`${origin}/api/refresh-request`, {
      method: 'POST',
      headers: { Authorization: AUTHORIZATION },
    });
    expect(post.status).toBe(200);
    const created = await post.json();
    expect(created).toEqual({
      ok: true,
      requested_at: expect.any(String),
    });

    const get = await fetch(`${origin}/api/refresh-request`, {
      headers: { Authorization: AUTHORIZATION },
    });
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({
      status: 'pending',
      requested_at: created.requested_at,
    });
  });

  it('throttles a second pending request within sixty seconds', async () => {
    const first = await fetch(`${origin}/api/refresh-request`, {
      method: 'POST',
      headers: { Authorization: AUTHORIZATION },
    });
    const created = await first.json();

    const second = await fetch(`${origin}/api/refresh-request`, {
      method: 'POST',
      headers: { Authorization: AUTHORIZATION },
    });
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual({
      throttled: true,
      requested_at: created.requested_at,
    });
  });

  it('records completion result and exposes it to the website poller', async () => {
    await fetch(`${origin}/api/refresh-request`, {
      method: 'POST',
      headers: { Authorization: AUTHORIZATION },
    });
    const result = { ok: true, checked_at: '2026-07-23T10:32:11-04:00' };
    const complete = await fetch(`${origin}/api/refresh-request/complete`, {
      method: 'POST',
      headers: {
        Authorization: AUTHORIZATION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ result }),
    });
    expect(complete.status).toBe(200);

    const get = await fetch(`${origin}/api/refresh-request`, {
      headers: { Authorization: AUTHORIZATION },
    });
    expect(await get.json()).toEqual({
      status: 'done',
      completed_at: expect.any(String),
      result,
    });
  });

  it('allows the website to request and read refresh status without a browser token', async () => {
    const post = await fetch(`${origin}/api/refresh-request`, { method: 'POST' });
    expect(post.status).toBe(200);

    const response = await fetch(`${origin}/api/refresh-request`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'pending' });
  });

  it('atomically stores a valid pushed snapshot and returns the same JSON', async () => {
    const snapshot = {
      payload: {
        as_of: '2026-07-14',
        currency: 'USD',
        net_liquidation: 135481.26,
        positions: [{ broker: 'IBKR', symbol: 'SGOV', asset_type: 'etf', qty: 548, market_value: 55084.96 }],
      },
      pushed_at: '2026-07-15T05:00:00.000Z',
      source: 'futu-assistant',
    };

    const post = await fetch(`${origin}/api/portfolio/positions`, {
      method: 'POST',
      headers: { Authorization: AUTHORIZATION, 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    expect(post.status).toBe(200);

    const publicGet = await fetch(`${origin}/api/portfolio/positions`);
    expect(publicGet.status).toBe(200);
    expect(await publicGet.json()).toEqual(snapshot);
    const get = await fetch(`${origin}/api/portfolio/positions`, {
      headers: { Authorization: AUTHORIZATION },
    });
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(snapshot);
    expect(JSON.parse(await readFile(join(storageRoot, 'latest.json'), 'utf8'))).toEqual(snapshot);
  });

  it('keeps snapshot writes protected by the bearer token', async () => {
    const response = await fetch(`${origin}/api/portfolio/positions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-value', 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: { positions: [], net_liquidation: 0 } }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'unauthorized', message: '认证失败' } });
  });

  it('rejects an invalid payload with 400', async () => {
    const response = await fetch(`${origin}/api/portfolio/positions`, {
      method: 'POST',
      headers: { Authorization: AUTHORIZATION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: { positions: [] }, pushed_at: new Date().toISOString(), source: 'futu-assistant' }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({ error: expect.objectContaining({ code: 'invalid_payload' }) }));
  });

  it('keeps the existing health route working', async () => {
    const response = await fetch(`${origin}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ ok: true }));
  });

  it('exposes the fixed daily channel-review colors as a public read-only endpoint', async () => {
    const response = await fetch(`${origin}/api/portfolio/channel-alerts`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      review_time: '16:20', timezone: 'America/New_York', symbols: expect.any(Object),
    }));
  });

  it('atomically stores and returns a protected quant analysis snapshot', async () => {
    const snapshot = {
      source: 'futu-assistant',
      generated_at: '2026-07-15T16:00:00-04:00',
      rule_version: '2.2',
      disclaimer: '认知参考；历史统计不代表未来收益',
      context: {},
      symbols: { SOXL: { gates: {}, gates_passed: 0, gates_total: 6 } },
      holding_costs: { MSFT: { weighted_average_cost: 115, currency: 'USD', coverage: 'complete', auto_fill_allowed: true } },
    };

    const post = await fetch(`${origin}/api/portfolio/quant-analysis`, {
      method: 'POST',
      headers: { Authorization: AUTHORIZATION, 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({
      ok: true, symbol_count: 1, generated_at: snapshot.generated_at, alerts_sent: 0,
    });

    const publicGet = await fetch(`${origin}/api/portfolio/quant-analysis`);
    expect(publicGet.status).toBe(200);
    expect(await publicGet.json()).toEqual(snapshot);
    const get = await fetch(`${origin}/api/portfolio/quant-analysis`, {
      headers: { Authorization: AUTHORIZATION },
    });
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(snapshot);
    expect(JSON.parse(await readFile(join(storageRoot, 'analysis', 'latest.json'), 'utf8'))).toEqual(snapshot);
  });

  it('compresses large protected analysis responses when the client accepts gzip', async () => {
    const snapshot = {
      source: 'futu-assistant',
      generated_at: '2026-08-11T03:00:00-04:00',
      rule_version: '2.2',
      context: { audit_blob: 'x'.repeat(8_000) },
      symbols: { AVGO: { gates: {}, gates_passed: 0, gates_total: 1 } },
    };
    const post = await fetch(`${origin}/api/portfolio/quant-analysis`, {
      method: 'POST',
      headers: { Authorization: AUTHORIZATION, 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    expect(post.status).toBe(200);

    const response = await fetch(`${origin}/api/portfolio/quant-analysis`, {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-encoding')).toBe('gzip');
    expect(await response.json()).toEqual(snapshot);
  });

  it('protects quant analysis writes and validates the export envelope', async () => {
    const unauthorized = await fetch(`${origin}/api/portfolio/quant-analysis`, {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-value', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(unauthorized.status).toBe(401);

    const invalid = await fetch(`${origin}/api/portfolio/quant-analysis`, {
      method: 'POST',
      headers: { Authorization: AUTHORIZATION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'other', generated_at: 'invalid', symbols: [] }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual(expect.objectContaining({ error: expect.objectContaining({ code: 'invalid_envelope' }) }));
  });

  it('serves the stored Futu slope for configured symbols without contacting a public quote source', async () => {
    const maSlope = {
      available: true,
      model: 'ma200_20d_annualized',
      role: 'trend_context_only',
      buy_veto: false,
      ma_period: 200,
      change_window_sessions: 20,
      annualization_sessions: 252,
      annualized_pct: 17.22,
      current_ma: 341.8,
      comparison_ma: 337.2,
      direction: 'up',
      regime: 'strong_up',
      label: '强势上涨',
      as_of: '2026-08-19',
      price_adjustment: 'QFQ',
      data_source: 'Futu OpenD closed daily bars',
      formula: '(MA200_t / MA200_t-20 - 1) × 252 / 20 × 100',
      reason: '趋势向上；不影响回撤买入判定。',
      series: [{ date: '2026-08-19', annualized_pct: 17.22 }],
    };
    const snapshot = {
      source: 'futu-assistant',
      generated_at: '2026-08-20T09:16:00-04:00',
      rule_version: '2.2',
      symbols: { AVGO: { available: true, ma_slope: maSlope } },
    };
    const post = await fetch(`${origin}/api/portfolio/quant-analysis`, {
      method: 'POST',
      headers: { Authorization: AUTHORIZATION, 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    expect(post.status).toBe(200);

    const response = await fetch(`${origin}/api/portfolio/ma-slope?symbol=avgo`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...maSlope,
      symbol: 'AVGO',
      decision_use: false,
      query_source: 'decision_snapshot',
    });

    const invalid = await fetch(`${origin}/api/portfolio/ma-slope?symbol=AAPL%2F..%2Fsecret`);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: 'invalid_symbol' }),
    }));

    const invalidChart = await fetch(`${origin}/api/portfolio/ma-slope?symbol=AVGO&view=dashboard&range=forever&slope_window=5`);
    expect(invalidChart.status).toBe(400);
    expect(await invalidChart.json()).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: 'invalid_chart_options' }),
    }));
  });

  it('keeps the gateway alive when quant analysis storage fails', async () => {
    const port = await freePort();
    const failureOrigin = `http://127.0.0.1:${port}`;
    const failureRoot = await mkdtemp(join(tmpdir(), 'portfolio-analysis-failure-'));
    const blockedRoot = join(failureRoot, 'not-a-directory');
    await writeFile(blockedRoot, 'blocked');
    const failureChild = spawn(process.execPath, ['deploy/aliyun-gateway.mjs'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        PORTFOLIO_SYNC_TOKEN: 'unit-secret',
        PORTFOLIO_ANALYSIS_ROOT: blockedRoot,
      },
      stdio: 'ignore',
    });
    try {
      await waitUntilReady(failureOrigin);
      const response = await fetch(`${failureOrigin}/api/portfolio/quant-analysis`, {
        method: 'POST',
        headers: { Authorization: AUTHORIZATION, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'futu-assistant',
          generated_at: '2026-07-15T16:00:00-04:00',
          rule_version: '2.2',
          symbols: {},
        }),
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: { code: 'quant_analysis_error', message: '量化分析服务暂不可用' },
      });
      await expect(fetch(`${failureOrigin}/api/health`)).resolves.toMatchObject({ ok: true });
    } finally {
      failureChild.kill('SIGTERM');
      await rm(failureRoot, { recursive: true, force: true });
    }
  });

  it('hides the route as 404 when the feature token is not configured', async () => {
    const port = await freePort();
    const disabledOrigin = `http://127.0.0.1:${port}`;
    const disabled = spawn(process.execPath, ['deploy/aliyun-gateway.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', PORTFOLIO_SYNC_TOKEN: '' },
      stdio: 'ignore',
    });
    try {
      await waitUntilReady(disabledOrigin);
      const response = await fetch(`${disabledOrigin}/api/portfolio/positions`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { code: 'no_data', message: '尚无量化系统持仓数据' } });
      const refresh = await fetch(`${disabledOrigin}/api/refresh-request`);
      expect(refresh.status).toBe(404);
      expect(await refresh.json()).toEqual({ error: { code: 'not_found', message: '未知接口' } });
    } finally {
      disabled.kill('SIGTERM');
    }
  });

  it('passes the portfolio sync token through the VPS PM2 deployment', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');
    expect(script).toContain("printf -v PORTFOLIO_SYNC_ENV 'PORTFOLIO_SYNC_TOKEN=%q '");
    expect(script).toContain('${PORTFOLIO_SYNC_ENV}');
  });

  it('deploys the alert tracker in the versioned release and passes Bark only when explicitly supplied', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');
    expect(script).toContain('REMOTE_RELEASE_ROOT=');
    expect(script).toContain('deploy/alert-tracker.mjs "${SERVER}:${REMOTE_RELEASE_APP}/alert-tracker.mjs"');
    expect(script).toContain('deploy/quant-decision-alerts.mjs "${SERVER}:${REMOTE_RELEASE_APP}/quant-decision-alerts.mjs"');
    expect(script).toContain('deploy/ma-slope-query.mjs "${SERVER}:${REMOTE_RELEASE_APP}/ma-slope-query.mjs"');
    expect(script).toContain("node --check '${REMOTE_RELEASE_APP}/ma-slope-query.mjs'");
    expect(script).toContain("printf -v BARK_ENV 'BARK_DEVICE_KEY=%q '");
    expect(script).toContain('${BARK_ENV}');
    expect(script).not.toContain('BARK_DEVICE_KEY=${BARK_DEVICE_KEY:-}');
  });
});

describe('行情代理顺带给出当前时段', () => {
  it('/api/quotes 返回 session 和服务器时间，供日志页状态条使用', async () => {
    const response = await fetch(`${origin}/api/quotes?symbols=`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(['pre', 'regular', 'post', 'overnight', 'closed']).toContain(body.session);
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });
});

