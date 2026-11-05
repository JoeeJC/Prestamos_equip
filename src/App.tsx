import { useState } from 'react';
import { LogOut, LayoutGrid, Clock3, Wrench } from 'lucide-react';
import { AuthProvider, hasRole, useAuth } from '@/lib/auth';
import { ThemeProvider } from '@/lib/theme';
import Header from '@/components/Header';
import Login from '@/components/Login';
import Catalog from '@/components/Catalog';
import MyLoans from '@/components/MyLoans';
import AdminTabs from '@/components/AdminTabs';
import ReserveModal from '@/components/ReserveModal';
import type { Equipo } from '@/lib/supabase';

type View = 'catalog' | 'loans' | 'admin';

function Shell() {
  const { session, loading, logout } = useAuth();
  const [view, setView] = useState<View>('catalog');
  const [reserve, setReserve] = useState<Equipo | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-500">
        Cargando…
      </div>
    );
  }

  if (!session) return <Login />;

  const canAdmin =
    hasRole(session, 'Pañol') || hasRole(session, 'Administrativo');

  const nav: { id: View; label: string; icon: typeof LayoutGrid; show: boolean }[] = [
    { id: 'catalog', label: 'Catálogo', icon: LayoutGrid, show: true },
    { id: 'loans', label: 'Mis préstamos', icon: Clock3, show: true },
    { id: 'admin', label: 'Panel de Administrador', icon: Wrench, show: canAdmin },
  ];

  const user = (
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        <p className="text-sm font-medium text-gray-900 dark:text-white">
          {session.usuario.nombre} {session.usuario.apellido}
        </p>
        <p className="text-xs text-gray-500">
          {session.roles.map((r) => r.nombre).join(' · ') || 'Sin rol'}
        </p>
      </div>
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
        {session.usuario.nombre[0]}
        {session.usuario.apellido[0]}
      </div>
      <button type="button" onClick={logout} className="btn-ghost h-9 w-9 !px-0" title="Cerrar sesión">
        <LogOut size={18} />
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <Header right={user} onHome={() => setView('catalog')} />

      {/* Nav móvil: pestañas inferiores; nav escritorio: barra superior */}
      <nav className="sticky top-16 z-20 border-b border-gray-200 bg-white/80 backdrop-blur dark:border-gray-800 dark:bg-gray-950/80">
        <div className="mx-auto flex max-w-7xl gap-1 px-2 sm:px-6">
          {nav.filter((n) => n.show).map((n) => {
            const Icon = n.icon;
            const active = view === n.id;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => setView(n.id)}
                className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition ${
                  active
                    ? 'text-brand-600 dark:text-brand-300'
                    : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <Icon size={16} />
                <span>{n.label}</span>
                {active && (
                  <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-600" />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-6 pb-24 sm:px-6 sm:pb-10">
        {view === 'catalog' && <Catalog onReserve={(eq) => setReserve(eq)} />}
        {view === 'loans' && <MyLoans refreshKey={refreshKey} />}
        {view === 'admin' && canAdmin && <AdminTabs />}
      </main>

      <footer className="border-t border-gray-200 py-6 text-center text-xs text-gray-400 dark:border-gray-800">
        ITU Equipos · Universidad ITU · Sistema de gestión de préstamos y reservas
      </footer>

      {reserve && (
        <ReserveModal
          initialEquipo={reserve}
          onClose={() => setReserve(null)}
          onDone={() => {
            setReserve(null);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </ThemeProvider>
  );
}
