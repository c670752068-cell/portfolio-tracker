import { describe, expect, it } from 'vitest';
import {
  resolveTheme,
  sanitizeThemeMode,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from './theme';

describe('theme preference', () => {
  it.each([
    ['light', false, 'light'],
    ['dark', false, 'dark'],
    ['system', false, 'light'],
    ['system', true, 'dark'],
  ] satisfies readonly [ThemeMode, boolean, 'light' | 'dark'][] )(
    'resolves %s with system dark=%s to %s',
    (mode, systemDark, expected) => {
      expect(resolveTheme(mode, systemDark)).toBe(expected);
    },
  );

  it('falls back to system for stale localStorage values', () => {
    expect(sanitizeThemeMode('sepia')).toBe('system');
    expect(sanitizeThemeMode(null)).toBe('system');
    expect(THEME_STORAGE_KEY).toBe('portfolio-tracker:theme');
  });
});
