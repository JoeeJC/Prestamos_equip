import type { ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme';

export default function Header({ right, onHome }: { right?: ReactNode; onHome: () => void }) {
  const { theme, toggle } = useTheme();
  return (
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/80 backdrop-blur dark:border-gray-800 dark:bg-gray-950/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <button
          type="button"
          onClick={onHome}
          aria-label="Ir al catálogo de equipos"
          title="Ir al catálogo"
          className="flex min-w-0 items-center gap-3 rounded-md transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <span className="flex items-baseline text-2xl font-black leading-none tracking-tight text-gray-900 dark:text-white">
            <span className="relative">
              ı
              <span className="absolute left-1/2 top-[-0.05em] h-[0.2em] w-[0.2em] -translate-x-1/2 rounded-full bg-red-600" />
            </span>
            <span>t</span>
            <span>u</span>
          </span>
          <span className="hidden border-l-2 border-red-600 pl-3 text-left text-[11px] font-semibold uppercase leading-tight tracking-[0.12em] text-gray-800 dark:text-gray-100 sm:block">
            Instituto Tecnológico
            <br />
            Universitario
          </span>
        </button>
        <div className="flex items-center gap-2">
          {right}
          <button
            type="button"
            onClick={toggle}
            aria-label="Cambiar tema"
            className="btn-ghost h-9 w-9 !px-0"
            title={theme === 'light' ? 'Modo oscuro' : 'Modo claro'}
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
        </div>
      </div>
    </header>
  );
}
