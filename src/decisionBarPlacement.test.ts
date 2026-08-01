import { describe, expect, it } from 'vitest';
import appSource from './App.tsx?raw';
import barSource from './components/DecisionStatusBar.tsx?raw';

describe('the single-conclusion bar lives on 总览 only', () => {
  it('renders exactly once', () => {
    // A-5: the bar used to hang off every tab and ate the whole 375px first screen.
    const renders = appSource.match(/<DecisionStatusBar\b/g) ?? [];

    expect(renders).toHaveLength(1);
  });

  it('renders inside the dashboard branch', () => {
    const dashboard = appSource.indexOf("tab === 'dashboard' && (");
    const holdings = appSource.indexOf("tab === 'holdings' && (");
    const render = appSource.indexOf('<DecisionStatusBar');

    expect(dashboard).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(dashboard);
    expect(render).toBeLessThan(holdings);
  });

  it('never pins the bar to the viewport', () => {
    // It scrolls with the page; a second sticky block would eat the 375px first screen again.
    expect(barSource).not.toContain('sticky');
    expect(barSource).not.toContain('fixed');
  });
});
