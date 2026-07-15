import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('GitHub Pages canonical deployment redirect', () => {
  it('sends old GitHub Pages bookmarks to the shared VPS portfolio', async () => {
    const source = await readFile('public/runtime-config.js', 'utf8');
    const replace = vi.fn();
    const window = {
      location: { hostname: 'c670752068-cell.github.io', replace },
      __PORTFOLIO_TRACKER_RUNTIME__: undefined,
    };

    runInNewContext(source, { window });

    expect(replace).toHaveBeenCalledWith('http://67.215.255.196:8788/');
  });

  it('does not redirect an unrelated local preview', async () => {
    const source = await readFile('public/runtime-config.js', 'utf8');
    const replace = vi.fn();
    const window = {
      location: { hostname: 'localhost', replace },
      __PORTFOLIO_TRACKER_RUNTIME__: undefined,
    };

    runInNewContext(source, { window });

    expect(replace).not.toHaveBeenCalled();
  });
});
