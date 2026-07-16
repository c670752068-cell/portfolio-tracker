import { createServer } from 'node:http';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pushPositions } from './push-positions.mjs';

type RequestRecord = { method: string; url: string; body: unknown };

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fakeCli(root: string): Promise<{ cli: string; analysis: string }> {
  const cli = join(root, 'futu-assistant');
  const analysis = join(root, 'site_export.json');
  await writeFile(cli, `#!/bin/sh
if [ "$1" = "positions-status" ]; then
  printf '%s' '{"as_of":"2026-07-15","currency":"USD","net_liquidation":1000,"positions":[{"symbol":"MSFT","asset_type":"stock","qty":2,"market_value":800}]}'
elif [ "$1" = "site-export" ]; then
  printf '%s' '{"source":"futu-assistant","generated_at":"2026-07-15T16:00:00-04:00","rule_version":"2.2","symbols":{"MSFT":{"gates":{},"gates_passed":0,"gates_total":6}}}' > "$FUTU_ASSISTANT_SITE_EXPORT"
  printf '%s' '{"ok":true}'
else
  exit 2
fi
`, 'utf8');
  await chmod(cli, 0o700);
  return { cli, analysis };
}

async function testServer(analysisStatus: number): Promise<{
  origin: string;
  requests: RequestRecord[];
  close: () => Promise<void>;
}> {
  const requests: RequestRecord[] = [];
  const server = createServer(async (req, res) => {
    const parts: Buffer[] = [];
    for await (const part of req) parts.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
    requests.push({ method: req.method || '', url: req.url || '', body });
    const status = req.url === '/api/portfolio/quant-analysis' ? analysisStatus : 200;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(status === 200 ? '{"ok":true}' : '{"error":"busy"}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server address unavailable');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function setup(analysisStatus: number) {
  const root = await mkdtemp(join(tmpdir(), 'portfolio-push-'));
  temporaryRoots.push(root);
  const { cli, analysis } = await fakeCli(root);
  const server = await testServer(analysisStatus);
  const log = join(root, 'sync.log');
  vi.stubEnv('FUTU_ASSISTANT_CLI', cli);
  vi.stubEnv('FUTU_ASSISTANT_SITE_EXPORT', analysis);
  vi.stubEnv('PORTFOLIO_GATEWAY_ORIGIN', server.origin);
  vi.stubEnv('PORTFOLIO_SYNC_TOKEN', 'unit-token');
  vi.stubEnv('PORTFOLIO_SYNC_LOG', log);
  return { ...server, log };
}

describe('portfolio Mac push chain', () => {
  it('pushes holdings first and then the independent site analysis snapshot', async () => {
    const fixture = await setup(200);
    try {
      const result = await pushPositions();

      expect(result).toEqual(expect.objectContaining({ count: 1, analysisPushed: true }));
      expect(fixture.requests.map((item) => item.url)).toEqual([
        '/api/portfolio/positions',
        '/api/portfolio/quant-analysis',
      ]);
      expect(fixture.requests[1].body).toEqual(expect.objectContaining({ source: 'futu-assistant' }));
      expect(await readFile(fixture.log, 'utf8')).toContain('status=analysis_success');
    } finally {
      await fixture.close();
    }
  });

  it('keeps a successful holdings push when analysis delivery fails', async () => {
    const fixture = await setup(503);
    try {
      await expect(pushPositions()).resolves.toEqual(expect.objectContaining({ count: 1, analysisPushed: false }));
      expect(fixture.requests[0].url).toBe('/api/portfolio/positions');
      expect(await readFile(fixture.log, 'utf8')).toContain('status=analysis_failure');
    } finally {
      await fixture.close();
    }
  });
});
