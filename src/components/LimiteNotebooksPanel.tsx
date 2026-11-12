import { useEffect, useState } from 'react';
import { Settings, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { actualizarLimiteNotebooks, obtenerLimiteNotebooks } from '@/lib/prestamos';

export default function LimiteNotebooksPanel() {
  const { session } = useAuth();
  const idUsuario = session?.usuario.id_usuario;
  const [limiteActual, setLimiteActual] = useState<number | null>(null);
  const [nuevoValor, setNuevoValor] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    obtenerLimiteNotebooks()
      .then((l) => {
        if (active) setLimiteActual(l);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'No se pudo leer el límite actual');
      });
    return () => {
      active = false;
    };
  }, []);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idUsuario) return;
    setError(null);
    setExito(null);
    const valor = Number(nuevoValor);
    if (!Number.isInteger(valor) || valor < 1 || valor > 20) {
      setError('Ingresá un número entero entre 1 y 20.');
      return;
    }
    if (!password) {
      setError('Ingresá tu contraseña para confirmar el cambio.');
      return;
    }
    setBusy(true);
    try {
      const guardado = await actualizarLimiteNotebooks(idUsuario, password, valor);
      setLimiteActual(guardado);
      setNuevoValor('');
      setPassword('');
      setExito(`El límite se actualizó a ${guardado} notebooks por estudiante.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el límite');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card mx-auto max-w-xl p-6">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
        <Settings size={18} className="text-brand-600" /> Límite de notebooks por estudiante
      </h2>
      <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
        Cantidad máxima de notebooks que un estudiante puede tener reservadas o en curso al mismo tiempo.
        Profesores y personal de pañol no tienen límite.
      </p>

      <div className="mb-5 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Límite actual</p>
        <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
          {limiteActual ?? '…'} <span className="text-sm font-normal text-gray-500">notebooks</span>
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {exito && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle size={16} className="mt-0.5 shrink-0" />
          <span>{exito}</span>
        </div>
      )}

      <form onSubmit={guardar} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Nuevo límite (1 a 20)
          </label>
          <input
            type="number"
            min={1}
            max={20}
            step={1}
            className="input"
            value={nuevoValor}
            onChange={(e) => setNuevoValor(e.target.value)}
            placeholder="Ej: 3"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Tu contraseña para confirmar
          </label>
          <input
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </div>
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Guardando…' : 'Guardar límite'}
        </button>
      </form>
    </div>
  );
}
