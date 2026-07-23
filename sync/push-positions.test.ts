import { createServer } from 'node:http';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultRefreshRequestProcessor,
  createRefreshRequestProcessor,
  pushPositions,
} from './push-positions.mjs';

type RequestRecord = { method: string; url: string; body: unknown };

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fakeCli(root: string, analysisStdoutBytes = 0): Promise<{
  cli: string;
  analysis: string;
  cliLog: string;
}> {
  const cli = join(root, 'futu-assistant');
  const analysis = join(root, 'site_export.json');
  const cliLog = join(root, 'cli.log');
  await writeFile(cli, `#!/bin/sh
printf '%s\\n' "$1" >> "$FAKE_CLI_LOG"
if [ "$1" = "positions-status" ]; then
  printf '%s' '{"as_of":"2026-07-15","currency":"USD","net_liquidation":1000,"positions":[{"symbol":"MSFT","asset_type":"stock","qty":2,"market_value":800}]}'
elif [ "$1" = "site-export" ]; then
  printf '%s' '{"source":"futu-assistant","generated_at":"2026-07-15T16:00:00-04:00","rule_version":"2.2","symbols":{"MSFT":{"gates":{},"gates_passed":0,"gates_total":6}}}' > "$FUTU_ASSISTANT_SITE_EXPORT"
  if [ "${analysisStdoutBytes}" -gt 0 ]; then
    head -c "${analysisStdoutBytes}" /dev/zero | tr '\\0' 'x'
  fi
  printf '%s' '{"ok":true}'
elif [ "$1" = "refresh-now" ]; then
  printf '%s' '{"ok":true,"checked_at":"2026-07-23T10:32:11-04:00","notifications_sent":0,"symbols_checked":18}'
else
  exit 2
fi
`, 'utf8');
  await chmod(cli, 0o700);
  return { cli, analysis, cliLog };
}

async function testServer(analysisStatus: number, refreshStatus = 'idle'): Promise<{
  origin: string;
  requests: RequestRecord[];
  close: () => Promise<void>;
}> {
  const requests: RequestRecord[] = [];
  const server = createServer(async (req, res) => {
    const parts: Buffer[] = [];
    for await (const part of req) parts.push(Buffer.from(part));
    const text = Buffer.concat(parts).toString('utf8');
    const body = text ? JSON.parse(text) : null;
    requests.push({ method: req.method || '', url: req.url || '', body });
    if (req.url === '/api/refresh-request' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: refreshStatus }));
      return;
    }
    if (req.url === '/api/refresh-request/complete') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
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

async function setup(analysisStatus: number, analysisStdoutBytes = 0, refreshStatus = 'idle') {
  const root = await mkdtemp(join(tmpdir(), 'portfolio-push-'));
  temporaryRoots.push(root);
  const { cli, analysis, cliLog } = await fakeCli(root, analysisStdoutBytes);
  const server = await testServer(analysisStatus, refreshStatus);
  const log = join(root, 'sync.log');
  vi.stubEnv('FUTU_ASSISTANT_CLI', cli);
  vi.stubEnv('FUTU_ASSISTANT_SITE_EXPORT', analysis);
  vi.stubEnv('FAKE_CLI_LOG', cliLog);
  vi.stubEnv('PORTFOLIO_GATEWAY_ORIGIN', server.origin);
  vi.stubEnv('PORTFOLIO_SYNC_TOKEN', 'unit-token');
  vi.stubEnv('PORTFOLIO_SYNC_LOG', log);
  return { ...server, log, cliLog };
}

describe('portfolio Mac push chain', () => {
  it('keeps the 45-minute fallback and adds a separate persistent watch agent', async () => {
    const fallback = await readFile('sync/com.portfolio.sync.plist', 'utf8');
    const watcher = await readFile('sync/com.portfolio.refresh-watch.plist', 'utf8');
    const readme = await readFile('README.md', 'utf8');

    expect(fallback).toContain('<integer>2700</integer>');
    expect(fallback).not.toContain('<string>--watch</string>');
    expect(watcher).toContain('<string>--watch</string>');
    expect(watcher).toContain('<key>KeepAlive</key>');
    expect(watcher).not.toContain('PORTFOLIO_SYNC_TOKEN');
    expect(readme).toContain('com.portfolio.refresh-watch.plist');
  });

  it('runs refresh-now before pushing snapshots and then reports completion', async () => {
    const calls: string[] = [];
    const processor = createRefreshRequestProcessor({
      readRequest: async () => {
        calls.push('poll');
        return { status: 'pending', requested_at: '2026-07-23T10:32:00.000Z' };
      },
      refreshNow: async () => {
        calls.push('refresh-now');
        return { ok: true, checked_at: '2026-07-23T10:32:11-04:00' };
      },
      pushSnapshots: async () => {
        calls.push('push-snapshots');
        return { count: 18, pushedAt: '2026-07-23T14:32:20.000Z', analysisPushed: true };
      },
      completeRequest: async () => {
        calls.push('complete');
      },
    });

    await processor.pollOnce();

    expect(calls).toEqual(['poll', 'refresh-now', 'push-snapshots', 'complete']);
  });

  it('reports an on-demand failure without throwing out of watch mode', async () => {
    const completions: unknown[] = [];
    const processor = createRefreshRequestProcessor({
      readRequest: async () => ({ status: 'pending' }),
      refreshNow: async () => {
        throw new Error('OpenD 暂不可用');
      },
      pushSnapshots: async () => {
        throw new Error('must not run');
      },
      completeRequest: async (result: unknown) => {
        completions.push(result);
      },
    });

    await expect(processor.pollOnce()).resolves.toEqual(expect.objectContaining({
      status: 'done',
      result: { ok: false, error: 'OpenD 暂不可用' },
    }));
    expect(completions).toEqual([{ ok: false, error: 'OpenD 暂不可用' }]);
  });

  it('ignores another pending poll while the current refresh is running', async () => {
    let releaseRefresh: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    let refreshCalls = 0;
    const processor = createRefreshRequestProcessor({
      readRequest: async () => ({ status: 'pending' }),
      refreshNow: async () => {
        refreshCalls += 1;
        markStarted?.();
        await blocked;
        return { ok: true };
      },
      pushSnapshots: async () => ({ analysisPushed: true }),
      completeRequest: async () => undefined,
    });

    const first = processor.pollOnce();
    await started;
    await expect(processor.pollOnce()).resolves.toEqual({
      status: 'ignored',
      reason: 'running',
    });
    releaseRefresh?.();
    await first;
    expect(refreshCalls).toBe(1);
  });

  it('does nothing when the gateway has no pending request', async () => {
    const refreshNow = vi.fn();
    const processor = createRefreshRequestProcessor({
      readRequest: async () => ({ status: 'idle' }),
      refreshNow,
      pushSnapshots: vi.fn(),
      completeRequest: vi.fn(),
    });

    await expect(processor.pollOnce()).resolves.toEqual({ status: 'idle' });
    expect(refreshNow).not.toHaveBeenCalled();
  });

  it('wires a pending gateway request to the real CLI and snapshot chain', async () => {
    const fixture = await setup(200, 0, 'pending');
    try {
      const processor = await createDefaultRefreshRequestProcessor();
      await expect(processor.pollOnce()).resolves.toEqual(expect.objectContaining({
        status: 'done',
        result: expect.objectContaining({ ok: true }),
      }));
      expect((await readFile(fixture.cliLog, 'utf8')).trim().split('\n')).toEqual([
        'refresh-now',
        'positions-status',
        'site-export',
      ]);
      expect(fixture.requests.map((item) => item.url)).toEqual([
        '/api/refresh-request',
        '/api/portfolio/positions',
        '/api/portfolio/quant-analysis',
        '/api/refresh-request/complete',
      ]);
    } finally {
      await fixture.close();
    }
  });

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

  it('accepts a site-export CLI stdout larger than 1MB when the snapshot file is valid', async () => {
    const fixture = await setup(200, 2 * 1024 * 1024);
    try {
      await expect(pushPositions()).resolves.toEqual(expect.objectContaining({
        count: 1,
        analysisPushed: true,
      }));
      expect(fixture.requests.map((item) => item.url)).toEqual([
        '/api/portfolio/positions',
        '/api/portfolio/quant-analysis',
      ]);
    } finally {
      await fixture.close();
    }
  });
});
