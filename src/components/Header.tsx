import type { ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme';

export default function Header({ right }: { right?: ReactNode }) {
  const { theme, toggle } = useTheme();
  return (
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/80 backdrop-blur dark:border-gray-800 dark:bg-gray-950/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
            <span className="text-sm font-bold tracking-tight">ITU</span>
          </div>
          <div className="leading-tight">
            <p className="text-base font-semibold text-gray-900 dark:text-white">ITU Equipos</p>
            <p className="hidden text-xs text-gray-500 dark:text-gray-400 sm:block">
              Gestión de préstamos y reservas
            </p>
          </div>
        </div>
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
