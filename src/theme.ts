export const THEME_STORAGE_KEY = 'portfolio-tracker:theme';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = Exclude<ThemeMode, 'system'>;

export function sanitizeThemeMode(value: string | null): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : 'system';
}

export function resolveTheme(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemDark ? 'dark' : 'light';
  return mode;
}

export function readThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  return sanitizeThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
}

export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const systemDark = typeof window !== 'undefined'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = resolveTheme(mode, systemDark);
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.dataset.theme = resolved;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    meta?.setAttribute('content', resolved === 'dark' ? '#0B0F14' : '#F7F8FA');
  }
  return resolved;
}
