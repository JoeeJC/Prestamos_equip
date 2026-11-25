import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';

type ThemeCtx = {
  theme: Theme;
};

const Ctx = createContext<ThemeCtx | null>(null);

const LEGACY_STORAGE_KEY = 'itu-equipos-theme';

function detectarTemaSistema(): Theme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function aplicarTemaDOM(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(detectarTemaSistema);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    aplicarTemaDOM(theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const actualizar = () => {
      const siguiente: Theme = mq.matches ? 'dark' : 'light';
      setTheme(siguiente);
      aplicarTemaDOM(siguiente);
    };
    actualizar();

    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', actualizar);
      return () => mq.removeEventListener('change', actualizar);
    }
    mq.addListener(actualizar);
    return () => mq.removeListener(actualizar);
  }, []);

  const value = useMemo<ThemeCtx>(() => ({ theme }), [theme]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme debe usarse dentro de ThemeProvider');
  return ctx;
}
