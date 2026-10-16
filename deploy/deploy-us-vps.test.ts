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
