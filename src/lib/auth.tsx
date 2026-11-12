import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase, type Rol, type Usuario } from './supabase';

type Session = {
  token: string;
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

function aSesion(data: unknown): Session {
  const r = data as Partial<Session> | null;
  if (!r || typeof r.token !== 'string' || !r.usuario || !Array.isArray(r.roles)) {
    throw new Error('Respuesta de sesión inválida');
  }
  return { token: r.token, usuario: r.usuario, roles: r.roles };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Restaurar sesión desde el token guardado y refrescar datos desde el servidor.
  useEffect(() => {
    let active = true;
    (async () => {
      const token = localStorage.getItem(STORAGE_KEY);
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const { data, error } = await supabase.rpc('restaurar_sesion', { p_token: token });
        if (error) throw new Error(error.message);
        if (!data) {
          localStorage.removeItem(STORAGE_KEY);
          return;
        }
        if (active) setSession(aSesion(data));
      } catch {
        // Si el servidor no responde se conserva el token para reintentar al recargar.
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
      const { data, error } = await supabase.rpc('iniciar_sesion', {
        p_dni: dni.trim(),
        p_password: password,
      });
      if (error) throw new Error(error.message);
      const s = aSesion(data);
      setSession(s);
      localStorage.setItem(STORAGE_KEY, s.token);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    const token = session?.token;
    setSession(null);
    localStorage.removeItem(STORAGE_KEY);
    if (token) void supabase.rpc('cerrar_sesion', { p_token: token });
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
