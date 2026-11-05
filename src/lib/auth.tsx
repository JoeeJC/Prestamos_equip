import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase, type Rol, type Usuario } from './supabase';

type Session = {
  usuario: Usuario;
  roles: Rol[];
};

type AuthCtx = {
  session: Session | null;
  loading: boolean;
  login: (dni: string, password: string) => Promise<void>;
  logout: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);
const STORAGE_KEY = 'itu-equipos-session';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Restaurar sesión guardada y refrescar roles desde la base.
  useEffect(() => {
    let active = true;
    (async () => {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setLoading(false);
        return;
      }
      try {
        const parsed = JSON.parse(raw) as Session;
        // Recargar usuario + roles para mantener datos frescos.
        const { data: u } = await supabase
          .from('usuarios')
          .select('*')
          .eq('id_usuario', parsed.usuario.id_usuario)
          .maybeSingle();
        if (u) {
          const { data: roles } = await supabase
            .from('usuario_roles')
            .select('roles(*)')
            .eq('id_usuario', u.id_usuario);
          const mapped = (roles ?? [])
            .flatMap((r: { roles: Rol | Rol[] | null }) => (Array.isArray(r.roles) ? r.roles : r.roles ? [r.roles] : []))
            .filter((r): r is Rol => !!r);
          if (active) setSession({ usuario: u as Usuario, roles: mapped });
        } else if (active) {
          setSession(parsed);
        }
      } catch {
        // ignorar
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const login = async (dni: string, password: string) => {
    setLoading(true);
    try {
      const { data: u, error } = await supabase
        .from('usuarios')
        .select('*')
        .eq('dni', dni.trim())
        .maybeSingle();
      if (error) throw error;
      if (!u) throw new Error('DNI no encontrado');
      if (u.password_hash !== password) throw new Error('Contraseña incorrecta');
      if (u.estado === 'Inactivo') throw new Error('Usuario inactivo');

      const { data: roles, error: rErr } = await supabase
        .from('usuario_roles')
        .select('roles(*)')
        .eq('id_usuario', u.id_usuario);
      if (rErr) throw rErr;
      const mapped = (roles ?? [])
        .flatMap((r: { roles: Rol | Rol[] | null }) => (Array.isArray(r.roles) ? r.roles : r.roles ? [r.roles] : []))
        .filter((r): r is Rol => !!r);

      const s: Session = { usuario: u as Usuario, roles: mapped };
      setSession(s);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setSession(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  const value = useMemo<AuthCtx>(
    () => ({ session, loading, login, logout }),
    [session, loading],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}

export function hasRole(session: Session | null, rol: string) {
  return !!session?.roles.some((r) => r.nombre === rol);
}
