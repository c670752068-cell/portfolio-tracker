import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('US VPS deployment bundle', () => {
  it('uploads every local module imported by the gateway entry point', async () => {
    const script = await readFile('deploy/deploy-us-vps.sh', 'utf8');

    expect(script).toContain(
      'scp deploy/refresh-request-route.mjs "${SERVER}:${REMOTE_APP}/refresh-request-route.mjs"',
    );
    expect(script).toContain(
      'scp deploy/market-session.mjs "${SERVER}:${REMOTE_APP}/market-session.mjs"',
    );
    expect(script).toContain(
      'scp deploy/yahoo-quote.mjs "${SERVER}:${REMOTE_APP}/yahoo-quote.mjs"',
    );
  });
});
