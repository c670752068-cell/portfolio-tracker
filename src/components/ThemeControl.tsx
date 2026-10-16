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
    <label className="flex min-h-11 w-fit shrink-0 items-center gap-1 rounded-lg px-1.5 text-[12px] text-ink-secondary active:bg-surface-overlay sm:gap-1.5 sm:rounded-xl sm:border sm:border-neutral/45 sm:bg-surface-raised sm:px-3 sm:text-xs">
      <span aria-hidden="true">◐</span>
      <span className="sr-only">主题</span>
      <select
        aria-label="主题"
        value={mode}
        onChange={(event) => update(event.target.value as ThemeMode)}
        className="min-h-9 w-1 appearance-none bg-transparent text-[0] font-medium text-ink-secondary outline-none sm:w-auto sm:max-w-none sm:appearance-auto sm:text-xs"
      >
        <option value="system">跟随系统</option>
        <option value="light">浅色</option>
        <option value="dark">深色</option>
      </select>
    </label>
  );
}
