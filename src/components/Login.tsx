import { useState } from 'react';
import { LogIn, AlertCircle, GraduationCap, ShieldCheck, Moon, Sun } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

const DEMO = [
  { dni: '34000001', desc: 'Ana López · Estudiante', pass: 'demo1234' },
  { dni: '34000004', desc: 'Pablo Ríos · Estudiante + Profesor', pass: 'demo1234' },
  { dni: '34000006', desc: 'Diego Fernández · Administrativo', pass: 'demo1234' },
  { dni: '34000005', desc: 'Sofía Núñez · Administrador', pass: 'panol1234' },
];

export default function Login() {
  const { login } = useAuth();
  const { theme, toggle } = useTheme();
  const [dni, setDni] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(dni, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión');
    } finally {
      setBusy(false);
    }
  };

  const quick = (d: string, p: string) => {
    setDni(d);
    setPassword(p);
    setError(null);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
      <div className="pointer-events-none absolute -top-32 -right-32 h-96 w-96 rounded-full bg-brand-200/40 blur-3xl dark:bg-brand-900/30" />
      <div className="pointer-events-none absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-brand-300/30 blur-3xl dark:bg-brand-800/20" />
      <button
        type="button"
        onClick={toggle}
        aria-label="Cambiar tema"
        className="absolute right-4 top-4 z-20 btn-ghost h-10 w-10 !px-0"
      >
        {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
      </button>

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-brand-600 text-white shadow-card">
            <span className="text-lg font-bold tracking-tight">ITU</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">ITU Equipos</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Sistema de préstamos y reservas de equipos
          </p>
        </div>

        <form onSubmit={submit} className="card p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <LogIn size={18} className="text-brand-600" /> Iniciar sesión
          </h2>

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            DNI
          </label>
          <input
            className="input mb-4"
            value={dni}
            onChange={(e) => setDni(e.target.value)}
            placeholder="Ej: 34000001"
            inputMode="numeric"
            autoFocus
          />

          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Contraseña
          </label>
          <input
            type="password"
            className="input mb-4"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>

        <div className="card mt-4 p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
            <ShieldCheck size={16} className="text-brand-600" />
            Cuentas de demostración
          </div>
          <div className="grid gap-2">
            {DEMO.map((d) => (
              <button
                key={d.dni}
                type="button"
                onClick={() => quick(d.dni, d.pass)}
                className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 text-left text-sm transition hover:border-brand-400 hover:bg-brand-50 dark:border-gray-800 dark:hover:border-brand-600 dark:hover:bg-gray-800"
              >
                <GraduationCap size={16} className="text-brand-600" />
                <span className="font-medium text-gray-800 dark:text-gray-100">{d.desc}</span>
                <span className="ml-auto text-xs text-gray-400">DNI {d.dni}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            Tocá una cuenta para autocompletar, luego presioná "Ingresar".
          </p>
        </div>
      </div>
    </div>
  );
}
