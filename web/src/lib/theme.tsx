import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';
/** The one accent colour. Each has a deep eggshell value and a lifted charcoal value in styles.css. */
export type Accent = 'blue' | 'red' | 'forest' | 'royal';
export const ACCENTS: { id: Accent; label: string }[] = [
  { id: 'blue', label: 'Blue' },
  { id: 'red', label: 'Red' },
  { id: 'forest', label: 'Forest' },
  { id: 'royal', label: 'Royal' },
];
const KEY = 'collected.theme';
const ACCENT_KEY = 'collected.accent';

interface ThemeCtx {
  theme: Theme;
  resolved: 'light' | 'dark';
  setTheme(t: Theme): void;
  accent: Accent;
  setAccent(a: Accent): void;
}

const Ctx = createContext<ThemeCtx | null>(null);

function readStored(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

function readAccent(): Accent {
  try {
    const v = localStorage.getItem(ACCENT_KEY);
    return v === 'red' || v === 'forest' || v === 'royal' ? v : 'blue';
  } catch {
    return 'blue';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored);
  const [accent, setAccentState] = useState<Accent>(readAccent);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }, [resolved]);

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);

  const value = useMemo<ThemeCtx>(
    () => ({
      theme,
      resolved,
      setTheme(t) {
        setThemeState(t);
        try {
          localStorage.setItem(KEY, t);
        } catch {}
      },
      accent,
      setAccent(a) {
        setAccentState(a);
        try {
          localStorage.setItem(ACCENT_KEY, a);
        } catch {}
      },
    }),
    [theme, resolved, accent],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme outside ThemeProvider');
  return v;
}
