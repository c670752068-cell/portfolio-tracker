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
  if [ "$FAKE_BROKER_MODE" = "no-broker-health" ]; then
    printf '%s' '{"as_of":"2026-07-15","currency":"USD","net_liquidation":1000,"positions":[{"symbol":"MSFT","broker":"IBKR","asset_type":"stock","qty":2,"market_value":800}]}'
  elif [ "$FAKE_BROKER_MODE" = "ibkr-down" ]; then
    printf '%s' '{"as_of":"2026-07-15","currency":"USD","net_liquidation":200,"broker_health":[{"broker":"IBKR","available":false,"error_code":"IBKR_UNAVAILABLE"},{"broker":"FUTU","available":true}],"positions":[{"symbol":"NVDA","broker":"FUTU","asset_type":"stock","qty":1,"market_value":200}]}'
  elif [ "$FAKE_BROKER_MODE" = "ibkr-stale" ] && [ ! -f "$FAKE_IBKR_FIXED" ]; then
    printf '%s' '{"as_of":"2026-07-15","currency":"USD","net_liquidation":200,"broker_health":[{"broker":"IBKR","available":false,"error_code":"IBKR_SNAPSHOT_STALE"},{"broker":"FUTU","available":true}],"positions":[{"symbol":"NVDA","broker":"FUTU","asset_type":"stock","qty":1,"market_value":200}]}'
  elif [ "$FAKE_BROKER_MODE" = "ibkr-decision-stale" ] && [ ! -f "$FAKE_IBKR_FIXED" ]; then
    printf '%s' '{"as_of":"2026-07-15","currency":"USD","net_liquidation":1000,"decision_freshness":{"data_stale":true,"stale_days":3,"max_stale_days":2,"stale_sources":["positions"]},"broker_health":[{"broker":"IBKR","available":true,"as_of":"2026-07-15"},{"broker":"FUTU","available":true,"as_of":"2026-07-18"}],"positions":[{"symbol":"MSFT","broker":"IBKR","asset_type":"stock","qty":2,"market_value":800},{"symbol":"NVDA","broker":"FUTU","asset_type":"stock","qty":1,"market_value":200}]}'
  elif [ "$FAKE_BROKER_MODE" = "longport-sdk-down" ] || { [ "$FAKE_BROKER_MODE" = "longport-transient" ] && [ ! -f "$FAKE_IBKR_FIXED" ]; }; then
    : > "$FAKE_IBKR_FIXED"
    printf '%s' '{"as_of":"2026-07-15","currency":"USD","net_liquidation":800,"broker_health":[{"broker":"IBKR","available":true},{"broker":"LONGPORT","available":false,"error_code":"LONGPORT_SDK"}],"positions":[{"symbol":"MSFT","broker":"IBKR","asset_type":"stock","qty":2,"market_value":800}]}'
  elif [ "$FAKE_BROKER_MODE" = "longport-down" ]; then
    printf '%s' '{"as_of":"2026-07-15","currency":"USD","net_liquidation":800,"broker_health":[{"broker":"IBKR","available":true},{"broker":"FUTU","available":true},{"broker":"LONGPORT","available":false,"error_code":"LONGPORT_UNAVAILABLE"}],"positions":[{"symbol":"MSFT","broker":"IBKR","asset_type":"stock","qty":2,"market_value":800}]}'
  elif [ "$FAKE_BROKER_MODE" = "longport-transient" ]; then
    printf '%s' '{"as_of":"2026-07-15","currency":"USD","net_liquidation":1000,"broker_health":[{"broker":"IBKR","available":true},{"broker":"LONGPORT","available":true}],"positions":[{"symbol":"MSFT","broker":"IBKR","asset_type":"stock","qty":2,"market_value":800},{"symbol":"NVDA","broker":"LONGPORT","asset_type":"stock","qty":1,"market_value":200}]}'
  elif [ "$FAKE_BROKER_MODE" = "ibkr-stale" ] || [ "$FAKE_BROKER_MODE" = "ibkr-decision-stale" ]; then
    printf '%s' '{"as_of":"2026-07-18","currency":"USD","net_liquidation":1000,"decision_freshness":{"data_stale":false,"stale_days":0,"max_stale_days":2,"stale_sources":[]},"broker_health":[{"broker":"IBKR","available":true,"as_of":"2026-07-18"},{"broker":"FUTU","available":true,"as_of":"2026-07-18"}],"positions":[{"symbol":"MSFT","broker":"IBKR","asset_type":"stock","qty":2,"market_value":800},{"symbol":"NVDA","broker":"FUTU","asset_type":"stock","qty":1,"market_value":200}]}'
  else
    printf '%s' '{"as_of":"2026-07-15","currency":"USD","net_liquidation":1000,"broker_health":[{"broker":"IBKR","available":true}],"positions":[{"symbol":"MSFT","broker":"IBKR","asset_type":"stock","qty":2,"market_value":800}]}'
  fi
elif [ "$1" = "sync-ibkr" ]; then
  : > "$FAKE_IBKR_FIXED"
  printf '%s' '{"ok":true,"as_of":"2026-07-15"}'
elif [ "$1" = "site-export" ]; then
  printf '%s' '{"source":"futu-assistant","generated_at":"2026-07-15T16:00:00-04:00","rule_version":"2.2","symbols":{"MSFT":{"gates":{},"gates_passed":0,"gates_total":6}}}' > "$FUTU_ASSISTANT_SITE_EXPORT"
  if [ "${analysisStdoutBytes}" -gt 0 ]; then
    head -c "${analysisStdoutBytes}" /dev/zero | tr '\\0' 'x'
  fi
  printf '%s' '{"ok":true}'
elif [ "$1" = "site-refresh" ] && [ "$2" = "--quick" ]; then
  printf '%s' '{"source":"futu-assistant","generated_at":"2026-07-23T10:32:11-04:00","rule_version":"2.2","final_verdict":{"decision":"LOCAL_MUST_NOT_PUBLISH"},"symbols":{"MSFT":{"gates":{}}},"valuation_tab":{"available":true,"generated_at":"2026-07-23T10:32:11-04:00","cnn":{"current_score":99},"anchors":[{"label":"LOCAL_MUST_NOT_PUBLISH"}],"distance_to_anchors":[{"label":"LOCAL_MUST_NOT_PUBLISH"}],"ndx":{"as_of":"2026-07-22","available":true,"stale":false,"stale_days":0,"gate_available":true,"current_pe":31.25,"percentile_lines":{"p30":24,"median":28,"p70":34},"history":[{"date":"2026-07-22","pe":31.25}]}}}' > "$FUTU_ASSISTANT_SITE_EXPORT"
  printf '%s' '{"source":"futu-assistant","generated_at":"2026-07-23T10:32:11-04:00","freshness":{"prices_at":"2026-07-23T10:32:11-04:00"},"symbols":{"MSFT":{"gates":{}}}}'
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
  const productionAnalysis = {
    source: 'futu-assistant',
    rule_version: '2.2',
    generated_at: '2026-07-20T16:00:00-04:00',
    final_verdict: { decision: 'PRODUCTION_HOLD' },
    symbols: { MSFT: { decision: 'PRODUCTION_WAIT' } },
    valuation_tab: {
      available: true,
      generated_at: '2026-07-20T16:00:00-04:00',
      cnn: { current_score: 47 },
      anchors: [{ label: 'PRODUCTION_ANCHOR' }],
      distance_to_anchors: [{ label: 'PRODUCTION_DISTANCE' }],
      ndx: { as_of: '2026-07-15', stale: true, current_pe: 30 },
    },
  };
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
    if (req.url === '/api/portfolio/quant-analysis' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(productionAnalysis));
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
  vi.stubEnv('FAKE_IBKR_FIXED', join(root, 'ibkr-fixed'));
  vi.stubEnv('PORTFOLIO_GATEWAY_ORIGIN', server.origin);
  vi.stubEnv('PORTFOLIO_SYNC_TOKEN', 'unit-token');
  vi.stubEnv('PORTFOLIO_SYNC_LOG', log);
  return { ...server, log, cliLog, analysis };
}

describe('portfolio Mac push chain', () => {
  it('uses the canonical HTTPS gateway when no origin override is configured', async () => {
    const source = await readFile('sync/push-positions.mjs', 'utf8');

    expect(source).toContain("const DEFAULT_ORIGIN = 'https://myopenid.top'");
    expect(source).not.toContain("const DEFAULT_ORIGIN = 'http://67.215.255.196:8788'");
  });

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

  it('gives site-refresh --quick enough time and stdout capacity for a real refresh', async () => {
    const source = await readFile('sync/push-positions.mjs', 'utf8');

    expect(source).toContain("['site-refresh', '--quick'], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 }");
  });

  it('runs site-refresh --quick before pushing snapshots and then reports completion', async () => {
    const calls: string[] = [];
    const processor = createRefreshRequestProcessor({
      readRequest: async () => {
        calls.push('poll');
        return { status: 'pending', requested_at: '2026-07-23T10:32:00.000Z' };
      },
      refreshNow: async () => {
        calls.push('site-refresh --quick');
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

    expect(calls).toEqual(['poll', 'site-refresh --quick', 'push-snapshots', 'complete']);
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
        'site-refresh',
        'positions-status',
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

  it('reuses an on-demand site-refresh export for NDX fallback without refreshing again', async () => {
    const fixture = await setup(200);
    vi.stubEnv('FAKE_BROKER_MODE', 'no-broker-health');
    await writeFile(fixture.analysis, JSON.stringify({
      source: 'futu-assistant',
      generated_at: '2026-07-23T10:32:11-04:00',
      rule_version: '2.2',
      final_verdict: { decision: 'LOCAL_MUST_NOT_PUBLISH' },
      symbols: { MSFT: { gates: {} } },
      valuation_tab: {
        generated_at: '2026-07-23T10:32:11-04:00',
        ndx: {
          as_of: '2026-07-22',
          available: true,
          stale: false,
          stale_days: 0,
          gate_available: true,
          current_pe: 31.25,
        },
      },
    }), 'utf8');
    try {
      await expect(pushPositions({
        reuseAnalysisSnapshot: true,
        now: new Date('2026-07-23T10:35:00-04:00'),
      })).rejects.toThrow('券商健康状态');
      expect((await readFile(fixture.cliLog, 'utf8')).trim().split('\n')).toEqual([
        'positions-status',
      ]);
      expect(fixture.requests.map((item) => `${item.method} ${item.url}`)).toEqual([
        'GET /api/portfolio/quant-analysis',
        'GET /api/portfolio/quant-analysis',
        'POST /api/portfolio/quant-analysis',
      ]);
      expect(await readFile(fixture.log, 'utf8')).toContain('status=ndx_fallback_success');
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

  it('repairs a stale IBKR snapshot before it can replace the complete server portfolio', async () => {
    const fixture = await setup(200);
    vi.stubEnv('FAKE_BROKER_MODE', 'ibkr-stale');
    try {
      await expect(pushPositions()).resolves.toEqual(expect.objectContaining({
        count: 2,
        analysisPushed: true,
      }));
      expect((await readFile(fixture.cliLog, 'utf8')).trim().split('\n')).toEqual([
        'positions-status',
        'sync-ibkr',
        'positions-status',
        'site-export',
      ]);
      expect(fixture.requests[0]).toEqual(expect.objectContaining({
        url: '/api/portfolio/positions',
        body: expect.objectContaining({
          payload: expect.objectContaining({
            positions: expect.arrayContaining([expect.objectContaining({ broker: 'IBKR' })]),
          }),
        }),
      }));
    } finally {
      await fixture.close();
    }
  });

  it('repairs IBKR when it is readable but already too stale for a buy decision', async () => {
    const fixture = await setup(200);
    vi.stubEnv('FAKE_BROKER_MODE', 'ibkr-decision-stale');
    try {
      await expect(pushPositions()).resolves.toEqual(expect.objectContaining({
        count: 2,
        analysisPushed: true,
      }));
      expect((await readFile(fixture.cliLog, 'utf8')).trim().split('\n')).toEqual([
        'positions-status',
        'sync-ibkr',
        'positions-status',
        'site-export',
      ]);
      expect(fixture.requests[0].body).toEqual(expect.objectContaining({
        payload: expect.objectContaining({
          decision_freshness: expect.objectContaining({ data_stale: false }),
        }),
      }));
    } finally {
      await fixture.close();
    }
  });

  it('持仓只认 IBKR：长桥不可用时照常上传 IBKR 持仓，只写一条日志', async () => {
    const fixture = await setup(200);
    vi.stubEnv('FAKE_BROKER_MODE', 'longport-down');
    try {
      await expect(pushPositions()).resolves.toEqual(expect.objectContaining({ count: 1 }));
      expect(fixture.requests).toEqual(expect.arrayContaining([
        expect.objectContaining({ method: 'POST', url: '/api/portfolio/positions' }),
      ]));
      const log = await readFile(fixture.log, 'utf8');
      expect(log).toContain('status=broker_degraded');
      expect(log).toContain('LONGPORT');
    } finally {
      await fixture.close();
    }
  });

  it('持仓只认 IBKR：IBKR 自己不可用时仍然拒绝覆盖服务器', async () => {
    const fixture = await setup(200);
    vi.stubEnv('FAKE_BROKER_MODE', 'ibkr-down');
    try {
      await expect(pushPositions()).rejects.toThrow('IBKR');
      expect(fixture.requests).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ method: 'POST', url: '/api/portfolio/positions' }),
      ]));
      expect(await readFile(fixture.log, 'utf8')).toContain('status=failure');
    } finally {
      await fixture.close();
    }
  });

  it('re-reads a transient LongPort SDK failure before publishing a complete snapshot', async () => {
    const fixture = await setup(200);
    vi.stubEnv('FAKE_BROKER_MODE', 'longport-transient');
    try {
      await expect(pushPositions()).resolves.toEqual(expect.objectContaining({
        count: 2, analysisPushed: true,
      }));
      expect((await readFile(fixture.cliLog, 'utf8')).trim().split('\n')).toEqual([
        'positions-status', 'positions-status', 'site-export',
      ]);
      expect(fixture.requests[0].body).toEqual(expect.objectContaining({
        payload: expect.objectContaining({
          broker_health: expect.arrayContaining([expect.objectContaining({ broker: 'LONGPORT', available: true })]),
        }),
      }));
      expect(await readFile(fixture.log, 'utf8')).toContain('status=broker_retry');
    } finally {
      await fixture.close();
    }
  });

  it('长桥 SDK 持续失败时只重读一次，然后照常上传 IBKR 持仓', async () => {
    const fixture = await setup(200);
    vi.stubEnv('FAKE_BROKER_MODE', 'longport-sdk-down');
    try {
      await expect(pushPositions()).resolves.toEqual(expect.objectContaining({ count: 1 }));
      expect((await readFile(fixture.cliLog, 'utf8')).trim().split('\n').filter((call) => call === 'positions-status')).toHaveLength(2);
      expect(fixture.requests).toEqual(expect.arrayContaining([
        expect.objectContaining({ method: 'POST', url: '/api/portfolio/positions' }),
      ]));
      const log = await readFile(fixture.log, 'utf8');
      expect(log).toContain('status=broker_degraded');
      expect(log).toContain('LONGPORT_SDK');
    } finally {
      await fixture.close();
    }
  });

  it('publishes only fresh NDX after a scheduled holdings failure and still reports that failure', async () => {
    const fixture = await setup(200);
    vi.stubEnv('FAKE_BROKER_MODE', 'no-broker-health');
    try {
      await expect(pushPositions({
        now: new Date('2026-07-23T10:35:00-04:00'),
      })).rejects.toThrow('券商健康状态');
      expect((await readFile(fixture.cliLog, 'utf8')).trim().split('\n')).toEqual([
        'positions-status',
        'site-refresh',
      ]);
      expect(fixture.requests.map((item) => `${item.method} ${item.url}`)).toEqual([
        'GET /api/portfolio/quant-analysis',
        'GET /api/portfolio/quant-analysis',
        'POST /api/portfolio/quant-analysis',
      ]);
      expect(fixture.requests[2].body).toEqual({
        source: 'futu-assistant',
        rule_version: '2.2',
        generated_at: '2026-07-20T16:00:00-04:00',
        final_verdict: { decision: 'PRODUCTION_HOLD' },
        symbols: { MSFT: { decision: 'PRODUCTION_WAIT' } },
        valuation_tab: {
          available: true,
          generated_at: '2026-07-20T16:00:00-04:00',
          cnn: { current_score: 47 },
          anchors: [{ label: 'PRODUCTION_ANCHOR' }],
          distance_to_anchors: [{ label: 'PRODUCTION_DISTANCE' }],
          ndx: expect.objectContaining({
            as_of: '2026-07-22',
            current_pe: 31.25,
          }),
        },
      });
      const log = await readFile(fixture.log, 'utf8');
      expect(log).toContain('status=ndx_fallback_success');
      expect(log).toContain('status=failure');
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
