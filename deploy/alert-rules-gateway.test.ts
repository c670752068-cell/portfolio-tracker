import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';

interface GatewayHarness {
  child: ChildProcess;
  origin: string;
  root: string;
}

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

async function waitUntilReady(origin: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {
      // The child process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('gateway did not start');
}

async function startGateway(): Promise<GatewayHarness> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const root = await mkdtemp(join(tmpdir(), 'portfolio-alerts-'));
  const child = spawn(process.execPath, ['deploy/aliyun-gateway.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      PORTFOLIO_ALERTS_ROOT: root,
      PORTFOLIO_SYNC_TOKEN: 'unit-secret',
      BARK_DEVICE_KEY: '',
    },
    stdio: 'ignore',
  });
  await waitUntilReady(origin);
  return { child, origin, root };
}

async function stopGateway(harness: GatewayHarness): Promise<void> {
  harness.child.kill('SIGTERM');
  await rm(harness.root, { recursive: true, force: true });
}

async function postRule(origin: string, rule: Record<string, unknown>): Promise<Response> {
  return fetch(`${origin}/api/portfolio/alert-rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  });
}

describe('portfolio alert-rules gateway', () => {
  it('creates, updates, publicly lists, and deletes a target rule across devices', async () => {
    const harness = await startGateway();
    try {
      const create = await postRule(harness.origin, {
        id: 'fngu-target',
        symbol: 'fngu',
        type: 'target_price',
        direction: 'above',
        target_price: 40,
        approach_pct: 5,
        reduce_to_pct: 5,
        enabled: true,
      });
      expect([200, 201]).toContain(create.status);
      expect(await create.json()).toEqual({
        ok: true,
        rule: expect.objectContaining({
          id: 'fngu-target',
          symbol: 'FNGU',
          type: 'target_price',
          target_price: 40,
          approach_pct: 5,
        }),
      });

      const firstDevice = await fetch(`${harness.origin}/api/portfolio/alert-rules`);
      expect(firstDevice.status).toBe(200);
      expect(await firstDevice.json()).toEqual({
        rules: [expect.objectContaining({ id: 'fngu-target', symbol: 'FNGU', target_price: 40 })],
      });

      const update = await postRule(harness.origin, {
        id: 'fngu-target',
        symbol: 'FNGU',
        type: 'target_price',
        direction: 'above',
        target_price: 42,
        approach_pct: 3,
        reduce_to_pct: 3,
        enabled: true,
      });
      expect(update.status).toBe(200);

      const secondDevice = await fetch(`${harness.origin}/api/portfolio/alert-rules`);
      expect(await secondDevice.json()).toEqual({
        rules: [expect.objectContaining({ id: 'fngu-target', target_price: 42, approach_pct: 3 })],
      });

      const remove = await fetch(`${harness.origin}/api/portfolio/alert-rules/fngu-target`, { method: 'DELETE' });
      expect(remove.status).toBe(200);
      expect(await remove.json()).toEqual({ ok: true, id: 'fngu-target' });
      expect(await (await fetch(`${harness.origin}/api/portfolio/alert-rules`)).json()).toEqual({ rules: [] });
    } finally {
      await stopGateway(harness);
    }
  });

  it('accepts a gain-threshold rule but rejects unsafe symbols and invalid numeric ranges', async () => {
    const harness = await startGateway();
    try {
      const gainRule = await postRule(harness.origin, {
        id: 'msft-gain',
        symbol: 'MSFT',
        type: 'gain_pct',
        cost_basis: 100,
        gain_pct: 20,
        approach_pct: 5,
        enabled: true,
      });
      expect([200, 201]).toContain(gainRule.status);
      expect(await gainRule.json()).toEqual({
        ok: true,
        rule: expect.objectContaining({
          id: 'msft-gain',
          symbol: 'MSFT',
          cost_basis: 100,
          gain_pct: 20,
        }),
      });

      const invalidRules = [
        { id: 'unsafe', symbol: 'MSFT;DROP', type: 'target_price', direction: 'above', target_price: 100, approach_pct: 5 },
        { id: 'bad-target', symbol: 'MSFT', type: 'target_price', direction: 'above', target_price: -1, approach_pct: 5 },
        { id: 'bad-cost', symbol: 'MSFT', type: 'gain_pct', cost_basis: 0, gain_pct: 20, approach_pct: 5 },
        { id: 'bad-approach', symbol: 'MSFT', type: 'target_price', direction: 'above', target_price: 100, approach_pct: 101 },
        { id: 'bad-action', symbol: 'MSFT', type: 'target_price', direction: 'above', target_price: 100, approach_pct: 5, reduce_to_pct: 101 },
      ];
      for (const rule of invalidRules) {
        const response = await postRule(harness.origin, rule);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(expect.objectContaining({
          error: expect.objectContaining({ code: 'invalid_rule' }),
        }));
      }
    } finally {
      await stopGateway(harness);
    }
  });

  it('enforces the 256KB alert request limit', async () => {
    const harness = await startGateway();
    try {
      const response = await postRule(harness.origin, {
        id: 'oversized',
        symbol: 'MSFT',
        type: 'target_price',
        direction: 'above',
        target_price: 500,
        approach_pct: 5,
        note: 'x'.repeat(257 * 1024),
      });
      expect(response.status).toBe(413);
    } finally {
      await stopGateway(harness);
    }
  });

  it('caps stored rules at 100', async () => {
    const harness = await startGateway();
    try {
      for (let index = 0; index < 100; index += 1) {
        const response = await postRule(harness.origin, {
          id: `rule-${index}`,
          symbol: `TEST${index}`,
          type: 'target_price',
          direction: 'above',
          target_price: index + 1,
          approach_pct: 5,
          enabled: true,
        });
        expect(response.ok).toBe(true);
      }
      const overflow = await postRule(harness.origin, {
        id: 'rule-overflow',
        symbol: 'OVER',
        type: 'target_price',
        direction: 'above',
        target_price: 1,
        approach_pct: 5,
        enabled: true,
      });
      expect(overflow.status).toBe(400);
      expect(await overflow.json()).toEqual(expect.objectContaining({
        error: expect.objectContaining({ code: 'rule_limit' }),
      }));
    } finally {
      await stopGateway(harness);
    }
  });
});
