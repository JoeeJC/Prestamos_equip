import { useEffect, useState } from 'react';
import { Settings, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import type { Categoria } from '@/lib/supabase';
import {
  LIMITE_MAX,
  LIMITE_MIN,
  actualizarLimiteCategoria,
  cargarCategorias,
} from '@/lib/prestamos';

const SIN_LIMITE = 'sin';
const OPCIONES = Array.from({ length: LIMITE_MAX - LIMITE_MIN + 1 }, (_, i) => String(LIMITE_MIN + i));

function valorOriginal(c: Categoria) {
  return c.limite_alumnos === null ? SIN_LIMITE : String(c.limite_alumnos);
}

export default function LimitesReservaPanel() {
  const { session } = useAuth();
  const idUsuario = session?.usuario.id_usuario;
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [borradores, setBorradores] = useState<Record<string, string>>({});
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(true);
  const [guardandoId, setGuardandoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    cargarCategorias()
      .then((c) => {
        if (!active) return;
        setCategorias(c);
        setCargando(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'No se pudieron cargar las categorías');
        setCargando(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const valorActual = (c: Categoria) => borradores[c.id_categoria] ?? valorOriginal(c);

  const guardar = async (c: Categoria) => {
    if (!idUsuario) return;
    setError(null);
    setExito(null);
    if (!password) {
      setError('Ingresá tu contraseña para confirmar el cambio.');
      return;
    }
    const valor = valorActual(c);
    setGuardandoId(c.id_categoria);
    try {
      const guardado = await actualizarLimiteCategoria(
        idUsuario,
        password,
        c.id_categoria,
        valor === SIN_LIMITE ? null : Number(valor),
      );
      setCategorias((prev) =>
        prev.map((x) => (x.id_categoria === c.id_categoria ? { ...x, limite_alumnos: guardado } : x)),
      );
      setBorradores((prev) => {
        const next = { ...prev };
        delete next[c.id_categoria];
        return next;
      });
      setExito(
        guardado === null
          ? `${c.nombre} quedó sin límite.`
          : `El límite de ${c.nombre} se actualizó a ${guardado} por estudiante.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el límite');
    } finally {
      setGuardandoId(null);
    }
  };

  return (
    <div className="card mx-auto max-w-2xl p-6">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
        <Settings size={18} className="text-brand-600" /> Límites de reserva por categoría
      </h2>
      <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
        Cantidad máxima de equipos de cada categoría que un estudiante puede tener reservados o en curso al mismo
        tiempo. Las categorías sin límite no tienen restricción. Profesores y personal de pañol no tienen límite.
      </p>

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

      <div className="mb-5">
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          Tu contraseña para confirmar cambios
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

      {cargando ? (
        <p className="py-8 text-center text-sm text-gray-500">Cargando categorías…</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {categorias.map((c) => {
            const valor = valorActual(c);
            const cambiado = valor !== valorOriginal(c);
            return (
              <li key={c.id_categoria} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-[10rem] flex-1">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{c.nombre}</p>
                  <p className="text-xs text-gray-500">
                    {c.limite_alumnos === null ? 'Sin límite' : `Máximo ${c.limite_alumnos} por estudiante`}
                  </p>
                </div>
                <select
                  className="input w-40"
                  value={valor}
                  onChange={(e) =>
                    setBorradores((prev) => ({ ...prev, [c.id_categoria]: e.target.value }))
                  }
                >
                  <option value={SIN_LIMITE}>Sin límite</option>
                  {OPCIONES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!cambiado || guardandoId !== null}
                  onClick={() => guardar(c)}
                  className="btn-secondary h-9 px-3 text-sm"
                >
                  {guardandoId === c.id_categoria ? 'Guardando…' : 'Guardar'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
