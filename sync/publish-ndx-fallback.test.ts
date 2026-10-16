import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  mergeFreshNdxCard,
  publishFreshNdxFallback,
} from './publish-ndx-fallback.mjs';

describe('NDX-only valuation fallback', () => {
  it('replaces only valuation_tab.ndx', () => {
    const online = {
      source: 'futu-assistant',
      generated_at: '2026-08-27T18:35:19.550Z',
      positions: { as_of: '2026-08-26', items: [{ symbol: 'MSFT', qty: 2 }] },
      final_verdict: { decision: 'HOLD', reason: 'existing production decision' },
      symbols: { MSFT: { decision: 'BUY', amount: 1200 } },
      valuation_tab: {
        generated_at: '2026-08-27T18:35:19.550Z',
        cnn: { value: 47, as_of: '2026-08-27' },
        ndx: {
          as_of: '2026-08-25',
          available: true,
          stale: true,
          stale_days: 8,
          gate_available: false,
          current_pe: 30,
        },
      },
    };
    const local = {
      source: 'futu-assistant',
      generated_at: '2026-09-07T14:00:00.000Z',
      positions: { as_of: '2026-09-04', items: [{ symbol: 'NVDA', qty: 99 }] },
      final_verdict: { decision: 'BUY', reason: 'must not escape fallback' },
      symbols: { NVDA: { decision: 'SELL', amount: 999999 } },
      valuation_tab: {
        generated_at: '2026-09-07T14:00:00.000Z',
        cnn: { value: 99, as_of: '2026-09-07' },
        ndx: {
          as_of: '2026-09-04',
          available: true,
          stale: false,
          stale_days: 0,
          gate_available: true,
          current_pe: 31.25,
          zone: 'normal',
          history: [{ date: '2026-09-04', pe: 31.25 }],
        },
      },
    };
    const onlineBefore = structuredClone(online);
    const localBefore = structuredClone(local);

    const merged = mergeFreshNdxCard(online, local, {
      now: new Date('2026-09-07T14:05:00.000Z'),
    });

    expect(merged).toEqual({
      ...online,
      valuation_tab: {
        ...online.valuation_tab,
        ndx: local.valuation_tab.ndx,
      },
    });
    expect(online).toEqual(onlineBefore);
    expect(local).toEqual(localBefore);
  });

  it('refuses a local NDX card explicitly marked stale', () => {
    const online = {
      generated_at: '2026-08-27T18:35:19.550Z',
      valuation_tab: { ndx: { as_of: '2026-08-25' } },
    };
    const local = {
      generated_at: '2026-09-07T14:00:00.000Z',
      valuation_tab: {
        generated_at: '2026-09-07T14:00:00.000Z',
        ndx: {
          as_of: '2026-09-04',
          available: true,
          stale: true,
          stale_days: 1,
          gate_available: false,
          current_pe: 31.25,
        },
      },
    };

    expect(() => mergeFreshNdxCard(online, local, {
      now: new Date('2026-09-07T14:05:00.000Z'),
    })).toThrow('stale');
  });

  it('refuses a local NDX card with unknown stale state', () => {
    const online = { valuation_tab: { ndx: { as_of: '2026-08-25' } } };
    const local = {
      generated_at: '2026-09-07T14:00:00.000Z',
      valuation_tab: {
        generated_at: '2026-09-07T14:00:00.000Z',
        ndx: {
          as_of: '2026-09-04',
          available: true,
          stale_days: 0,
          gate_available: true,
          current_pe: 31.25,
        },
      },
    };

    expect(() => mergeFreshNdxCard(online, local, {
      now: new Date('2026-09-07T14:05:00.000Z'),
    })).toThrow('stale state');
  });

  it('refuses a local NDX card that is unavailable', () => {
    const online = { valuation_tab: { ndx: { as_of: '2026-08-25' } } };
    const local = {
      generated_at: '2026-09-07T14:00:00.000Z',
      valuation_tab: {
        generated_at: '2026-09-07T14:00:00.000Z',
        ndx: {
          as_of: '2026-09-04',
          available: false,
          stale: false,
          stale_days: 0,
          gate_available: false,
          current_pe: null,
        },
      },
    };

    expect(() => mergeFreshNdxCard(online, local, {
      now: new Date('2026-09-07T14:05:00.000Z'),
    })).toThrow('unavailable');
  });

  it('refuses inconsistent freshness fields instead of trusting stale=false', () => {
    const online = { valuation_tab: { ndx: { as_of: '2026-08-25' } } };
    const local = {
      generated_at: '2026-09-07T14:00:00.000Z',
      valuation_tab: {
        generated_at: '2026-09-07T14:00:00.000Z',
        ndx: {
          as_of: '2026-09-04',
          available: true,
          stale: false,
          stale_days: 1,
          gate_available: false,
          current_pe: 31.25,
        },
      },
    };

    expect(() => mergeFreshNdxCard(online, local, {
      now: new Date('2026-09-07T14:05:00.000Z'),
    })).toThrow('freshness');
  });

  it('refuses a local NDX card without an explicit zero stale_days value', () => {
    const online = { valuation_tab: { ndx: { as_of: '2026-08-25' } } };
    const local = {
      generated_at: '2026-09-07T14:00:00.000Z',
      valuation_tab: {
        generated_at: '2026-09-07T14:00:00.000Z',
        ndx: {
          as_of: '2026-09-04',
          available: true,
          stale: false,
          gate_available: true,
          current_pe: 31.25,
        },
      },
    };

    expect(() => mergeFreshNdxCard(online, local, {
      now: new Date('2026-09-07T14:05:00.000Z'),
    })).toThrow('freshness');
  });

  it('refuses a valid-looking card from an old site_export file', () => {
    const online = { valuation_tab: { ndx: { as_of: '2026-08-25' } } };
    const local = {
      generated_at: '2026-09-07T13:40:00.000Z',
      valuation_tab: {
        generated_at: '2026-09-07T13:40:00.000Z',
        ndx: {
          as_of: '2026-09-04',
          available: true,
          stale: false,
          stale_days: 0,
          gate_available: true,
          current_pe: 31.25,
        },
      },
    };

    expect(() => mergeFreshNdxCard(online, local, {
      now: new Date('2026-09-07T14:00:01.000Z'),
      maxExportAgeMs: 15 * 60 * 1000,
    })).toThrow('site_export is not recent');
  });

  it('refuses an NDX card whose market date is not newer than production', () => {
    const online = { valuation_tab: { ndx: { as_of: '2026-09-04' } } };
    const local = {
      generated_at: '2026-09-07T14:00:00.000Z',
      valuation_tab: {
        generated_at: '2026-09-07T14:00:00.000Z',
        ndx: {
          as_of: '2026-09-04',
          available: true,
          stale: false,
          stale_days: 0,
          gate_available: true,
          current_pe: 31.25,
        },
      },
    };

    expect(() => mergeFreshNdxCard(online, local, {
      now: new Date('2026-09-07T14:05:00.000Z'),
    })).toThrow('not newer than production');
  });

  it('refuses an available card without a usable PE value', () => {
    const online = { valuation_tab: { ndx: { as_of: '2026-08-25' } } };
    const local = {
      generated_at: '2026-09-07T14:00:00.000Z',
      valuation_tab: {
        generated_at: '2026-09-07T14:00:00.000Z',
        ndx: {
          as_of: '2026-09-04',
          available: true,
          stale: false,
          stale_days: 0,
          gate_available: true,
          current_pe: null,
        },
      },
    };

    expect(() => mergeFreshNdxCard(online, local, {
      now: new Date('2026-09-07T14:05:00.000Z'),
    })).toThrow('current_pe');
  });

  it('re-GETs production immediately before POST and rebases the NDX-only patch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ndx-fallback-'));
    const exportPath = join(root, 'site_export.json');
    const firstOnline = {
      source: 'futu-assistant',
      rule_version: '2.2',
      generated_at: '2026-08-27T18:35:19.550Z',
      final_verdict: { decision: 'HOLD', revision: 1 },
      symbols: { MSFT: { decision: 'WAIT', revision: 1 } },
      valuation_tab: {
        generated_at: '2026-08-27T18:35:19.550Z',
        cnn: { value: 47 },
        anchors: [{ label: 'old anchor', ndx_pe: 22 }],
        distance_to_anchors: [{ label: 'old distance', current_pe: 30 }],
        ndx: { as_of: '2026-08-25', stale: true },
      },
    };
    const latestOnline = {
      ...firstOnline,
      final_verdict: { decision: 'HOLD', revision: 2 },
      symbols: { MSFT: { decision: 'WAIT', revision: 2 } },
    };
    const local = {
      source: 'futu-assistant',
      rule_version: '2.2',
      generated_at: '2026-09-07T14:00:00.000Z',
      final_verdict: { decision: 'BUY', revision: 999 },
      symbols: { NVDA: { decision: 'SELL', revision: 999 } },
      valuation_tab: {
        generated_at: '2026-09-07T14:00:00.000Z',
        cnn: { value: 99 },
        anchors: [{ label: 'must not publish', ndx_pe: 44 }],
        distance_to_anchors: [{ label: 'must not publish', current_pe: 31.25 }],
        ndx: {
          as_of: '2026-09-04',
          available: true,
          stale: false,
          stale_days: 0,
          gate_available: true,
          current_pe: 31.25,
          percentile_lines: { p30: 24, median: 28, p70: 34 },
          history: [{ date: '2026-09-04', pe: 31.25 }],
        },
      },
    };
    await writeFile(exportPath, JSON.stringify(local), 'utf8');
    const calls: Array<{ method: string; authorization: string; body: unknown }> = [];
    let getCount = 0;
    const server = createServer(async (request, response) => {
      const parts: Buffer[] = [];
      for await (const part of request) parts.push(Buffer.from(part));
      const rawBody = Buffer.concat(parts).toString('utf8');
      calls.push({
        method: request.method || '',
        authorization: String(request.headers.authorization || ''),
        body: rawBody ? JSON.parse(rawBody) : null,
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      if (request.method === 'GET') {
        getCount += 1;
        response.end(JSON.stringify(getCount === 1 ? firstOnline : latestOnline));
      } else {
        response.end('{"ok":true}');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server address unavailable');

    try {
      await expect(publishFreshNdxFallback({
        origin: `http://127.0.0.1:${address.port}`,
        token: 'unit-token',
        exportPath,
        now: new Date('2026-09-07T14:05:00.000Z'),
      })).resolves.toEqual({
        published: true,
        asOf: '2026-09-04',
        productionGeneratedAt: latestOnline.generated_at,
      });
      expect(calls.map((call) => call.method)).toEqual(['GET', 'GET', 'POST']);
      expect(calls.every((call) => call.authorization === 'Bearer unit-token')).toBe(true);
      expect(calls[2].body).toEqual({
        ...latestOnline,
        valuation_tab: {
          ...latestOnline.valuation_tab,
          ndx: local.valuation_tab.ndx,
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
