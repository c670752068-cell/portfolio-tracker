import { describe, expect, it } from 'vitest';
import appSource from './App.tsx?raw';
import themeSource from './components/ThemeControl.tsx?raw';

describe('header stays compact on a phone', () => {
  it('puts the theme control on the title row instead of its own full-width row', () => {
    // Measured before: the header ate 29% of a 375x812 screen because the
    // theme picker was stretched to 343px on a row of its own.
    const titleRow = appSource.indexOf('我的投资组合');
    const themeControl = appSource.indexOf('<ThemeControl />');
    const nav = appSource.indexOf('<nav');

    expect(titleRow).toBeGreaterThan(-1);
    expect(themeControl).toBeGreaterThan(titleRow);
    expect(themeControl).toBeLessThan(nav);
  });

  it('never stretches the theme control to the full row width', () => {
    expect(themeSource).toContain('w-fit');
    expect(themeSource).toContain('shrink-0');
  });
});
