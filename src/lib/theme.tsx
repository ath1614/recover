import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'recover.theme';

function initial(): Theme {
  const stored = localStorage.getItem(KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Theme lives on <html data-theme>, so every token flips at once and the choice survives a reload. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return initial();
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* private mode: the toggle still works for this page */
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((current) => (current === 'light' ? 'dark' : 'light')), []);

  return { theme, toggle };
}

export function ThemeButton({ theme, toggle }: { theme: Theme; toggle: () => void }) {
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-pressed={theme === 'dark'}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
    >
      <span aria-hidden="true">{theme === 'light' ? '◐' : '◑'}</span>
      <span className="theme-toggle__label">{theme === 'light' ? 'Dark' : 'Light'}</span>
    </button>
  );
}
