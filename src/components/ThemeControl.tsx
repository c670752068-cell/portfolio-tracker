import { useEffect, useState } from 'react';
import {
  applyTheme,
  readThemeMode,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from '../theme';

export function ThemeControl() {
  const [mode, setMode] = useState<ThemeMode>(() => readThemeMode());

  useEffect(() => {
    applyTheme(mode);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystemTheme = () => {
      if (mode === 'system') applyTheme(mode);
    };
    media.addEventListener('change', syncSystemTheme);
    return () => media.removeEventListener('change', syncSystemTheme);
  }, [mode]);

  function update(next: ThemeMode) {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    setMode(next);
    applyTheme(next);
  }

  return (
    <label className="flex min-h-11 w-fit shrink-0 items-center gap-2 rounded-xl border border-neutral/45 bg-surface-raised px-3 text-xs text-ink-secondary">
      <span aria-hidden="true">◐</span>
      <span className="sr-only">主题</span>
      <select
        aria-label="主题"
        value={mode}
        onChange={(event) => update(event.target.value as ThemeMode)}
        className="min-h-9 bg-transparent font-medium text-ink-secondary outline-none"
      >
        <option value="system">跟随系统</option>
        <option value="light">浅色</option>
        <option value="dark">深色</option>
      </select>
    </label>
  );
}
