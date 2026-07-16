import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const AUTHORIZATION = 'Bearer unit-secret';
let child: ChildProcess;
let origin: string;
let storageRoot: string;

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
  child = spawn(process.execPath, ['deploy/aliyun-gateway.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      PORTFOLIO_SYNC_TOKEN: 'unit-secret',
      PORTFOLIO_POSITIONS_ROOT: storageRoot,
      PORTFOLIO_ANALYSIS_ROOT: join(storageRoot, 'analysis'),
    },
    stdio: 'ignore',
  });
  await waitUntilReady(origin);
});

afterAll(async () => {
  child.kill('SIGTERM');
  await rm(storageRoot, { recursive: true, force: true });
});

describe('portfolio positions gateway', () => {
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

    // Reading the latest shared snapshot must work on a second device without
    // copying browser-local credentials from the first device.
    const get = await fetch(`${origin}/api/portfolio/positions`);
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

  it('atomically stores and publicly returns a valid quant analysis snapshot', async () => {
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
    expect(await post.json()).toEqual({ ok: true, symbol_count: 1, generated_at: snapshot.generated_at });

    const get = await fetch(`${origin}/api/portfolio/quant-analysis`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(snapshot);
    expect(JSON.parse(await readFile(join(storageRoot, 'analysis', 'latest.json'), 'utf8'))).toEqual(snapshot);
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
      expect(await response.json()).toEqual({ error: { code: 'not_found', message: '未知接口' } });
    } finally {
      disabled.kill('SIGTERM');
    }
  });

  it('passes the portfolio sync token through the VPS PM2 deployment', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');
    expect(script).toContain("printf -v PORTFOLIO_SYNC_ENV 'PORTFOLIO_SYNC_TOKEN=%q '");
    expect(script).toContain('${PORTFOLIO_SYNC_ENV}');
  });

  it('deploys the alert tracker, backs up the gateway, and passes Bark only when explicitly supplied', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');
    expect(script).toContain('portfolio-gateway.mjs.bak-');
    expect(script).toContain('scp deploy/alert-tracker.mjs');
    expect(script).toContain("printf -v BARK_ENV 'BARK_DEVICE_KEY=%q '");
    expect(script).toContain('${BARK_ENV}');
    expect(script).not.toContain('BARK_DEVICE_KEY=${BARK_DEVICE_KEY:-}');
  });
});
