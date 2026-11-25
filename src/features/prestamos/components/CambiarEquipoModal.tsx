import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Search, Wrench } from 'lucide-react';
import ModalFrame from '@/components/ui/ModalFrame';
import { useAuth } from '@/context/AuthContext';
import {
  aMinutos, bloquesSeSolapan, cambiarEquipoEnPrestamo, normalizarHHMM, } from '@/features/configuracion/services/horariosService';
import { fechaLocalISO, horaLocalHHMMSS } from '@/utils/fechas';
import { supabase } from '@/services/supabaseClient';
import type { DetallePrestamo, Equipo } from '@/types/database';

type ReservaBloque = {
  inicio: string;
  fin: string;
};

export default function CambiarEquipoModal({
  idPrestamo,
  nombreUsuario,
  fechaPrestamo,
  horaInicioPrevista,
  horaFinPrevista,
  detalles,
  onCerrar,
  onCambiado,
}: {
  idPrestamo: string;
  nombreUsuario: string;
  fechaPrestamo: string;
  horaInicioPrevista: string;
  horaFinPrevista: string;
  detalles: DetallePrestamo[];
  onCerrar: () => void;
  onCambiado: (mensaje: string) => void;
}) {
  const { session } = useAuth();
  const [idDetalle, setIdDetalle] = useState(detalles[0]?.id_detalle ?? '');
  const [disponibles, setDisponibles] = useState<Equipo[]>([]);
  const [reservasDia, setReservasDia] = useState<Record<string, ReservaBloque[]>>({});
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [idEquipoNuevo, setIdEquipoNuevo] = useState('');
  const [estadoAnterior, setEstadoAnterior] = useState<'Disponible' | 'En mantenimiento'>('Disponible');
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detalleActual = useMemo(
    () => detalles.find((d) => d.id_detalle === idDetalle) ?? detalles[0],
    [detalles, idDetalle],
  );

  useEffect(() => {
    let activo = true;
    (async () => {
      const fechaObjetivo = fechaPrestamo || fechaLocalISO();
      const [{ data, error: err }, { data: detsDia }] = await Promise.all([
        supabase
          .from('equipos')
          .select('*, categorias_equipo(*)')
          .eq('estado', 'Disponible')
          .order('codigo_inventario'),
        supabase
          .from('detalle_prestamos')
          .select('id_prestamo, id_equipo, prestamos!inner(fecha_prestamo, hora_inicio_prevista, hora_fin_prevista, estado)')
          .eq('prestamos.fecha_prestamo', fechaObjetivo)
          .in('prestamos.estado', ['Reservado', 'En Curso']),
      ]);
      if (!activo) return;
      if (err) {
        setError(err.message);
      } else {
        setDisponibles((data ?? []) as Equipo[]);
        const mapa: Record<string, ReservaBloque[]> = {};
        for (const d of (detsDia ?? []) as any[]) {
          if (d.id_prestamo === idPrestamo) continue;
          const p = Array.isArray(d.prestamos) ? d.prestamos[0] : d.prestamos;
          if (!p || p.fecha_prestamo !== fechaObjetivo) continue;
          if (p.estado !== 'Reservado' && p.estado !== 'En Curso') continue;
          const bloque: ReservaBloque = {
            inicio: normalizarHHMM(p.hora_inicio_prevista),
            fin: normalizarHHMM(p.hora_fin_prevista),
          };
          mapa[d.id_equipo] = [...(mapa[d.id_equipo] ?? []), bloque];
        }
        setReservasDia(mapa);
      }
      setCargando(false);
    })();
    return () => {
      activo = false;
    };
  }, [fechaPrestamo, idPrestamo]);

  const tramoCambio = useMemo(() => {
    const hoy = fechaLocalISO();
    const ahora = horaLocalHHMMSS().slice(0, 5);
    const inicioBase = normalizarHHMM(horaInicioPrevista, '08:00');
    const fin = normalizarHHMM(horaFinPrevista, '22:00');
    let inicio = inicioBase;
    if (fechaPrestamo === hoy && aMinutos(ahora) > aMinutos(inicioBase) && aMinutos(ahora) < aMinutos(fin)) {
      inicio = ahora;
    }
    return { inicio, fin };
  }, [fechaPrestamo, horaInicioPrevista, horaFinPrevista]);

  const conflictoDeEquipo = useMemo(() => {
    return (idEquipo: string): ReservaBloque | null => {
      const lista = reservasDia[idEquipo] ?? [];
      return (
        lista.find((r) => bloquesSeSolapan(tramoCambio.inicio, tramoCambio.fin, r.inicio, r.fin)) ??
        null
      );
    };
  }, [reservasDia, tramoCambio]);

  const equiposFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const catActual = detalleActual?.equipos?.id_categoria;
    return [...disponibles]
      .filter((e) => {
        if (e.oculto_catalogo) return false;
        if (!q) return true;
        const txt = [e.codigo_inventario, e.marca_modelo, e.numero_serie, e.categorias_equipo?.nombre]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return txt.includes(q);
      })
      .sort((a, b) => {
        const ca = conflictoDeEquipo(a.id_equipo) ? 1 : 0;
        const cb = conflictoDeEquipo(b.id_equipo) ? 1 : 0;
        if (ca !== cb) return ca - cb;
        const aMisma = a.id_categoria === catActual ? 0 : 1;
        const bMisma = b.id_categoria === catActual ? 0 : 1;
        if (aMisma !== bMisma) return aMisma - bMisma;
        return a.codigo_inventario.localeCompare(b.codigo_inventario);
      });
  }, [disponibles, busqueda, detalleActual, conflictoDeEquipo]);

  const confirmar = async () => {
    if (!session || !detalleActual) return;
    if (!idEquipoNuevo) {
      setError('Elegí el equipo nuevo que se va a entregar en reemplazo.');
      return;
    }
    const choque = conflictoDeEquipo(idEquipoNuevo);
    if (choque) {
      setError(
        `No podés entregar ese equipo porque tiene una reserva superpuesta hoy (${choque.inicio}–${choque.fin} hs).`,
      );
      return;
    }

    setGuardando(true);
    setError(null);
    try {
      const res = await cambiarEquipoEnPrestamo(session.token, {
        idPrestamo,
        idDetalle: detalleActual.id_detalle,
        idEquipoNuevo,
        estadoEquipoAnterior: estadoAnterior,
        motivo,
      });
      onCambiado(
        `Cambio realizado para ${nombreUsuario}: se devolvió ${res.equipo_anterior} (${estadoAnterior}) y se entregó ${res.equipo_nuevo}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo realizar el cambio de equipo.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <ModalFrame
      titulo="Cambiar equipo en préstamo"
      onCerrar={onCerrar}
      footer={
        <>
          <button type="button" onClick={onCerrar} className="btn-secondary">
            Cancelar
          </button>
          <button
            type="button"
            disabled={guardando || !idEquipoNuevo || cargando}
            onClick={() => void confirmar()}
            className="btn-primary"
          >
            <ArrowLeftRight size={15} /> {guardando ? 'Cambiando…' : 'Confirmar cambio'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-brand-200 bg-brand-50/60 px-3.5 py-2.5 text-xs font-medium text-brand-800 dark:border-brand-900/50 dark:bg-brand-950/30 dark:text-brand-200">
          Préstamo en curso de {nombreUsuario}. Podés cambiar un equipo en cualquier momento sin depender de franjas de retiro.
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Equipo que devuelve el alumno */}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Equipo que devuelve
          </label>
          {detalles.length > 1 ? (
            <select
              className="input"
              value={detalleActual?.id_detalle ?? ''}
              onChange={(e) => setIdDetalle(e.target.value)}
            >
              {detalles.map((d) => (
                <option key={d.id_detalle} value={d.id_detalle}>
                  {d.equipos?.codigo_inventario} · {d.equipos?.categorias_equipo?.nombre ?? ''} ({d.equipos?.marca_modelo ?? '—'})
                </option>
              ))}
            </select>
          ) : (
            <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {detalleActual?.equipos?.codigo_inventario ?? '—'}
              </p>
              <p className="text-xs text-gray-500">
                {detalleActual?.equipos?.categorias_equipo?.nombre} · {detalleActual?.equipos?.marca_modelo ?? '—'}
              </p>
            </div>
          )}
        </div>

        {/* Estado en el que vuelve el equipo anterior */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Estado en el que queda el equipo devuelto
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setEstadoAnterior('Disponible')}
              className={`rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition ${
                estadoAnterior === 'Disponible'
                  ? 'border-brand-500 bg-brand-50 text-brand-800 dark:border-brand-700 dark:bg-brand-950/40 dark:text-brand-200'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300'
              }`}
            >
              <span className="block font-semibold">Disponible</span>
              <span className="text-[11px] opacity-80">Funciona bien (ej. le faltaba un programa)</span>
            </button>
            <button
              type="button"
              onClick={() => setEstadoAnterior('En mantenimiento')}
              className={`rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition ${
                estadoAnterior === 'En mantenimiento'
                  ? 'border-amber-500 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300'
              }`}
            >
              <span className="flex items-center gap-1 font-semibold">
                <Wrench size={12} /> En mantenimiento
              </span>
              <span className="text-[11px] opacity-80">Presentó falla o problema técnico</span>
            </button>
          </div>
        </div>

        {/* Selección de nuevo equipo */}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Nuevo equipo a entregar
          </label>
          <div className="relative mb-2">
            <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-gray-400" />
            <input
              className="input pl-9"
              placeholder="Buscar equipo disponible por código o modelo…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
          {cargando ? (
            <p className="py-4 text-center text-xs text-gray-500">Cargando equipos disponibles…</p>
          ) : equiposFiltrados.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 py-4 text-center text-xs text-gray-500 dark:border-gray-700">
              No hay equipos disponibles con ese criterio.
            </p>
          ) : (
            <ul className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
              {equiposFiltrados.map((eq) => {
                const seleccionado = idEquipoNuevo === eq.id_equipo;
                const choque = conflictoDeEquipo(eq.id_equipo);
                const otrasReservas = (reservasDia[eq.id_equipo] ?? []).filter((r) => r !== choque);
                return (
                  <li key={eq.id_equipo}>
                    <button
                      type="button"
                      disabled={Boolean(choque)}
                      onClick={() => setIdEquipoNuevo(eq.id_equipo)}
                      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition ${
                        choque
                          ? 'cursor-not-allowed border-gray-200 bg-gray-50/70 opacity-65 dark:border-gray-800 dark:bg-gray-900/40'
                          : seleccionado
                            ? 'border-brand-500 bg-brand-50/70 dark:border-brand-600 dark:bg-brand-950/30'
                            : 'border-gray-200 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900'
                      }`}
                    >
                      <span>
                        <span className="block text-sm font-semibold text-gray-900 dark:text-white">
                          {eq.codigo_inventario}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {eq.categorias_equipo?.nombre} · {eq.marca_modelo ?? '—'}
                        </span>
                        {choque ? (
                          <span className="mt-0.5 block text-[11px] font-medium text-red-600 dark:text-red-400">
                            Conflicto: reserva {choque.inicio}–{choque.fin} hs
                          </span>
                        ) : otrasReservas.length > 0 ? (
                          <span className="mt-0.5 block text-[11px] font-medium text-amber-700 dark:text-amber-300">
                            Reserva hoy: {otrasReservas.map((r) => `${r.inicio}–${r.fin}`).join(', ')}
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={`text-xs font-semibold ${
                          choque
                            ? 'text-red-500'
                            : seleccionado
                              ? 'text-brand-600 dark:text-brand-300'
                              : 'text-gray-400'
                        }`}
                      >
                        {choque ? 'Ocupado' : seleccionado ? 'Seleccionado' : 'Elegir'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Motivo opcional */}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Motivo del cambio (opcional)
          </label>
          <input
            className="input"
            placeholder="Ej: No tenía instalado Packet Tracer / falla en teclado…"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </div>
      </div>
    </ModalFrame>
  );
}
