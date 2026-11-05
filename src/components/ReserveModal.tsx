import { useEffect, useMemo, useState } from 'react';
import { X, Calendar, Clock, ShoppingCart, Trash2, PlusCircle } from 'lucide-react';
import { supabase, type Equipo, type Categoria } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import Badge, { estadoEquipoVariant } from '@/components/Badge';

const MAX_HOURS = 5;
const START_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

function pad(n: number) {
  return n.toString().padStart(2, '0');
}

export default function ReserveModal({
  initialEquipo,
  onClose,
  onDone,
}: {
  initialEquipo?: Equipo | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { session } = useAuth();
  const [cart, setCart] = useState<Equipo[]>(initialEquipo ? [initialEquipo] : []);
  const [equipos, setEquipos] = useState<Equipo[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [q, setQ] = useState('');
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [start, setStart] = useState('08');
  const [hours, setHours] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [{ data: e }, { data: c }] = await Promise.all([
        supabase
          .from('equipos')
          .select('*, categorias_equipo(*)')
          .eq('estado', 'Disponible')
          .order('codigo_inventario'),
        supabase.from('categorias_equipo').select('*').order('nombre'),
      ]);
      if (!active) return;
      setEquipos((e ?? []) as Equipo[]);
      setCategorias((c ?? []) as Categoria[]);
    })();
    return () => {
      active = false;
    };
  }, []);

  const startNum = parseInt(start, 10);
  const endNum = startNum + hours;
  const overMax = hours > MAX_HOURS;
  const fueraDeHorario = endNum > 22;

  const available = useMemo(() => {
    const inCart = new Set(cart.map((c) => c.id_equipo));
    const query = q.trim().toLowerCase();
    return equipos.filter((eq) => {
      if (inCart.has(eq.id_equipo)) return false;
      if (!query) return true;
      const hay = [eq.codigo_inventario, eq.marca_modelo, eq.categorias_equipo?.nombre]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(query);
    });
  }, [equipos, cart, q]);

  const addToCart = (eq: Equipo) => setCart((c) => [...c, eq]);
  const removeFromCart = (id: string) => setCart((c) => c.filter((x) => x.id_equipo !== id));

  const submit = async () => {
    if (!session) return;
    setError(null);
    if (cart.length === 0) {
      setError('Agregá al menos un equipo al carrito.');
      return;
    }
    if (overMax) {
      setError('El bloque no puede superar las 5 horas.');
      return;
    }
    if (fueraDeHorario) {
      setError('El horario de fin no puede ser posterior a las 22:00.');
      return;
    }
    if (session.usuario.estado === 'Sancionado') {
      setError('Tu usuario está sancionado y no puede realizar reservas.');
      return;
    }
    setBusy(true);
    try {
      const horaInicio = `${pad(startNum)}:00`;
      const horaFin = `${pad(endNum)}:00`;

      // Verificar superposición: que ningún equipo del carrito tenga ya un préstamo
      // activo (Reservado/En Curso) en la misma fecha que se solape con el bloque.
      const equipoIds = cart.map((c) => c.id_equipo);
      const { data: solapados } = await supabase
        .from('detalle_prestamos')
        .select('id_prestamo, id_equipo, prestamos!inner(fecha_prestamo, hora_inicio_prevista, hora_fin_prevista, estado)')
        .in('id_equipo', equipoIds)
        .in('prestamos.estado', ['Reservado', 'En Curso']);

      const conflictivos = (solapados ?? []).filter((d: any) => {
        const p = Array.isArray(d.prestamos) ? d.prestamos[0] : d.prestamos;
        if (!p) return false;
        if (p.fecha_prestamo !== fecha) return false;
        // Comparación simple de strings HH:MM.
        return !(horaFin <= p.hora_inicio_prevista.slice(0, 5) || horaInicio >= p.hora_fin_prevista.slice(0, 5));
      });

      if (conflictivos.length > 0) {
        const codigos = cart
          .filter((c) => conflictivos.some((c2: any) => c2.id_equipo === c.id_equipo))
          .map((c) => c.codigo_inventario);
        setError(`Algunos equipos ya están reservados en ese bloque: ${codigos.join(', ')}`);
        return;
      }

      const { data: prestamo, error: pErr } = await supabase
        .from('prestamos')
        .insert({
          id_usuario: session.usuario.id_usuario,
          fecha_prestamo: fecha,
          hora_inicio_prevista: horaInicio,
          hora_fin_prevista: horaFin,
          estado: 'Reservado',
        })
        .select()
        .single();

      if (pErr || !prestamo) throw new Error(pErr?.message ?? 'No se pudo crear la reserva');

      const detalles = cart.map((eq) => ({
        id_prestamo: prestamo.id_prestamo,
        id_equipo: eq.id_equipo,
      }));
      const { error: dErr } = await supabase.from('detalle_prestamos').insert(detalles);
      if (dErr) throw new Error(dErr.message);

      // Marcar equipos como Reservado.
      await supabase
        .from('equipos')
        .update({ estado: 'Reservado' })
        .in('id_equipo', equipoIds);

      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la reserva');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="flex h-[92vh] w-full max-w-3xl flex-col rounded-t-2xl bg-white shadow-card dark:bg-gray-950 sm:h-auto sm:max-h-[88vh] sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <ShoppingCart size={18} className="text-brand-600" /> Nueva reserva
          </h2>
          <button type="button" onClick={onClose} className="btn-ghost h-9 w-9 !px-0">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Bloque horario */}
          <div className="card mb-5 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
              <Calendar size={16} className="text-brand-600" /> Fecha y bloque horario
              <span className="ml-auto text-xs font-normal text-gray-500">
                Máximo 5 horas por reserva
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Fecha</label>
                <input
                  type="date"
                  className="input"
                  value={fecha}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setFecha(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Hora inicio</label>
                <select className="input" value={start} onChange={(e) => setStart(e.target.value)}>
                  {START_HOURS.map((h) => (
                    <option key={h} value={pad(h)}>
                      {pad(h)}:00
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Duración (horas)</label>
                <select
                  className="input"
                  value={hours}
                  onChange={(e) => setHours(parseInt(e.target.value, 10))}
                >
                  {[1, 2, 3, 4, 5].map((h) => (
                    <option key={h} value={h}>
                      {h} hora{h > 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="mt-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <Clock size={15} className="text-brand-600" />
              Bloque:{' '}
              <span className="font-semibold text-gray-900 dark:text-white">
                {pad(startNum)}:00 a {pad(endNum)}:00
              </span>
              {overMax && <span className="text-red-600">· excede el máximo de 5 horas</span>}
              {fueraDeHorario && !overMax && (
                <span className="text-red-600">· supera las 22:00</span>
              )}
            </p>
          </div>

          {/* Carrito */}
          <div className="card mb-5 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
              <ShoppingCart size={16} className="text-brand-600" /> Carrito
              <span className="ml-auto text-xs font-normal text-gray-500">
                {cart.length} equipo{cart.length === 1 ? '' : 's'}
              </span>
            </div>
            {cart.length === 0 ? (
              <p className="text-sm text-gray-500">El carrito está vacío. Agregá equipos abajo.</p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {cart.map((eq) => (
                  <li key={eq.id_equipo} className="flex items-center gap-3 py-2.5">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {eq.codigo_inventario} · {eq.categorias_equipo?.nombre}
                      </p>
                      <p className="text-xs text-gray-500">{eq.marca_modelo ?? '—'}</p>
                    </div>
                    <Badge variant={estadoEquipoVariant(eq.estado)}>{eq.estado}</Badge>
                    <button
                      type="button"
                      onClick={() => removeFromCart(eq.id_equipo)}
                      className="btn-ghost h-8 w-8 !px-0 text-red-500 hover:text-red-600"
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Selector de equipos disponibles */}
          <div className="card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
              <PlusCircle size={16} className="text-brand-600" /> Equipos disponibles
            </div>
            <input
              className="input mb-3"
              placeholder="Buscar equipo para agregar…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {available.length === 0 ? (
              <p className="text-sm text-gray-500">No hay equipos disponibles para agregar.</p>
            ) : (
              <ul className="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                {available.map((eq) => (
                  <li
                    key={eq.id_equipo}
                    className="flex items-center gap-2 rounded-lg border border-gray-200 p-2.5 dark:border-gray-800"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {eq.codigo_inventario}
                      </p>
                      <p className="text-xs text-gray-500">
                        {eq.categorias_equipo?.nombre} · {eq.marca_modelo ?? '—'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => addToCart(eq)}
                      className="btn-secondary h-8 px-2 text-xs"
                    >
                      <PlusCircle size={14} /> Agregar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
          <p className="text-xs text-gray-500">
            {cart.length} equipo(s) · bloque {pad(startNum)}:00–{pad(endNum)}:00
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="btn-primary"
            >
              {busy ? 'Reservando…' : 'Confirmar reserva'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
