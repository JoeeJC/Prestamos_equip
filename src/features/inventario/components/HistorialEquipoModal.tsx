import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Clock, History, Laptop, MessageSquareText, User } from 'lucide-react';
import Badge, { estadoEquipoVariant, estadoPrestamoVariant } from '@/components/ui/Badge';
import ModalFrame from '@/components/ui/ModalFrame';
import { supabase } from '@/services/supabaseClient';
import type { Equipo, Prestamo } from '@/types/database';

type UsuarioResumen = {
  id_usuario: string;
  dni: string;
  nombre: string;
  apellido: string;
  curso?: string | null;
};

type RegistroHistorial = {
  id_detalle: string;
  estado_salida: string | null;
  estado_devolucion: string | null;
  prestamos: (Omit<Prestamo, 'usuarios'> & { usuarios?: UsuarioResumen | null }) | null;
};

type FiltroHistorial = 'todos' | 'usados' | 'observaciones';

function formatearFecha(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function formatearHoraIso(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function etiquetaMetodo(metodo: Prestamo['metodo_entrega']): string | null {
  if (metodo === 'qr') return 'QR';
  if (metodo === 'codigo') return 'Código';
  if (metodo === 'manual') return 'Manual';
  return null;
}

function tieneObservacion(r: RegistroHistorial): boolean {
  const p = r.prestamos;
  return Boolean(
    r.estado_salida?.trim() ||
      r.estado_devolucion?.trim() ||
      p?.observaciones_entrega?.trim() ||
      p?.observaciones_devolucion?.trim(),
  );
}

export default function HistorialEquipoModal({
  equipo,
  onCerrar,
}: {
  equipo: Equipo;
  onCerrar: () => void;
}) {
  const [registros, setRegistros] = useState<RegistroHistorial[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroHistorial>('todos');

  useEffect(() => {
    let cancelado = false;
    const cargarHistorial = async () => {
      setCargando(true);
      setError(null);
      const { data, error: err } = await supabase
        .from('detalle_prestamos')
        .select(
          'id_detalle, estado_salida, estado_devolucion, prestamos!inner(*, usuarios(id_usuario, dni, nombre, apellido, curso))',
        )
        .eq('id_equipo', equipo.id_equipo);

      if (cancelado) return;
      setCargando(false);
      if (err) {
        setError('No se pudo cargar el historial del equipo.');
        return;
      }

      const lista = ((data ?? []) as RegistroHistorial[])
        .filter((r) => Boolean(r.prestamos))
        .sort((a, b) => {
          const pa = a.prestamos!;
          const pb = b.prestamos!;
          const fechaCmp = pb.fecha_prestamo.localeCompare(pa.fecha_prestamo);
          if (fechaCmp !== 0) return fechaCmp;
          return pb.hora_inicio_prevista.localeCompare(pa.hora_inicio_prevista);
        });
      setRegistros(lista);
    };

    void cargarHistorial();
    return () => {
      cancelado = true;
    };
  }, [equipo.id_equipo]);

  const resumen = useMemo(() => {
    const lista = registros ?? [];
    const usados = lista.filter(
      (r) => r.prestamos?.estado === 'En Curso' || r.prestamos?.estado === 'Devuelto',
    );
    const conObs = lista.filter(tieneObservacion);
    const ultimoUso = usados[0]?.prestamos?.fecha_prestamo
      ? formatearFecha(usados[0].prestamos.fecha_prestamo)
      : 'Sin usos aún';
    return {
      total: lista.length,
      usados: usados.length,
      conObs: conObs.length,
      ultimoUso,
    };
  }, [registros]);

  const visibles = useMemo(() => {
    const lista = registros ?? [];
    if (filtro === 'usados') {
      return lista.filter(
        (r) => r.prestamos?.estado === 'En Curso' || r.prestamos?.estado === 'Devuelto',
      );
    }
    if (filtro === 'observaciones') {
      return lista.filter(tieneObservacion);
    }
    return lista;
  }, [registros, filtro]);

  return (
    <ModalFrame
      titulo={`Historial · ${equipo.codigo_inventario}`}
      onCerrar={onCerrar}
      maxWidth="max-w-3xl"
      footer={
        <button type="button" onClick={onCerrar} className="btn-secondary">
          Cerrar
        </button>
      }
    >
      <div className="space-y-4">
        {/* Ficha del equipo */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5 dark:border-gray-800 dark:bg-gray-900/60">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2">
                <Laptop size={16} className="shrink-0 text-brand-600" />
                <p className="font-semibold text-gray-900 dark:text-white">
                  {equipo.codigo_inventario}
                  {equipo.marca_modelo ? ` · ${equipo.marca_modelo}` : ''}
                </p>
              </div>
              <p className="text-xs text-gray-500">
                {equipo.categorias_equipo?.nombre ?? 'Sin categoría'}
                {equipo.numero_serie ? ` · Serie ${equipo.numero_serie}` : ''}
              </p>
              {equipo.observaciones && (
                <p className="pt-1 text-xs text-gray-600 dark:text-gray-300">
                  Obs. técnica: {equipo.observaciones}
                </p>
              )}
            </div>
            <Badge variant={estadoEquipoVariant(equipo.estado)}>{equipo.estado}</Badge>
          </div>
        </div>

        {/* Métricas */}
        {!cargando && !error && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
              <p className="text-[11px] font-medium text-gray-500">Movimientos</p>
              <p className="mt-0.5 text-xl font-semibold text-gray-900 dark:text-white">{resumen.total}</p>
            </div>
            <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
              <p className="text-[11px] font-medium text-gray-500">Usos efectivos</p>
              <p className="mt-0.5 text-xl font-semibold text-brand-600 dark:text-brand-300">{resumen.usados}</p>
            </div>
            <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
              <p className="text-[11px] font-medium text-gray-500">Último uso</p>
              <p className="mt-0.5 text-sm font-semibold text-gray-900 dark:text-white">{resumen.ultimoUso}</p>
            </div>
            <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
              <p className="text-[11px] font-medium text-gray-500">Con observaciones</p>
              <p className="mt-0.5 text-xl font-semibold text-amber-600 dark:text-amber-300">{resumen.conObs}</p>
            </div>
          </div>
        )}

        {/* Filtros rápidos */}
        {!cargando && !error && (registros?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setFiltro('todos')}
              className={`rounded-lg px-2.5 py-1 font-medium transition ${
                filtro === 'todos'
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              Todos ({resumen.total})
            </button>
            <button
              type="button"
              onClick={() => setFiltro('usados')}
              className={`rounded-lg px-2.5 py-1 font-medium transition ${
                filtro === 'usados'
                  ? 'bg-brand-600 text-white'
                  : 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-200'
              }`}
            >
              Usados / En curso ({resumen.usados})
            </button>
            <button
              type="button"
              onClick={() => setFiltro('observaciones')}
              className={`rounded-lg px-2.5 py-1 font-medium transition ${
                filtro === 'observaciones'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200'
              }`}
            >
              Con observaciones ({resumen.conObs})
            </button>
          </div>
        )}

        {/* Contenido cronológico */}
        {cargando ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
            <History size={16} className="animate-pulse text-brand-600" />
            Cargando historial del equipo…
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        ) : visibles.length === 0 ? (
          <div className="rounded-xl border border-gray-200 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-800">
            {registros && registros.length > 0
              ? 'No hay registros que coincidan con este filtro.'
              : 'Este equipo todavía no registra reservas ni préstamos.'}
          </div>
        ) : (
          <ul className="space-y-2.5">
            {visibles.map((reg) => {
              const p = reg.prestamos!;
              const u = p.usuarios;
              const horaRetiro = formatearHoraIso(p.hora_retiro_real);
              const horaDevolucion = formatearHoraIso(p.hora_devolucion_real);
              const metEnt = etiquetaMetodo(p.metodo_entrega);
              const metDev = etiquetaMetodo(p.metodo_devolucion);

              const obsSalida = [reg.estado_salida, p.observaciones_entrega]
                .map((x) => x?.trim())
                .filter(Boolean)
                .join(' · ');
              const obsDevolucion = [reg.estado_devolucion, p.observaciones_devolucion]
                .map((x) => x?.trim())
                .filter(Boolean)
                .join(' · ');

              return (
                <li
                  key={reg.id_detalle}
                  className="rounded-xl border border-gray-200 p-3.5 text-sm dark:border-gray-800"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {formatearFecha(p.fecha_prestamo)}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                          <Clock size={12} />
                          {p.hora_inicio_prevista.slice(0, 5)}–{p.hora_fin_prevista.slice(0, 5)} hs
                        </span>
                        {p.codigo_retiro && (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                            {p.codigo_retiro}
                          </span>
                        )}
                      </div>

                      <p className="flex flex-wrap items-center gap-1.5 text-xs text-gray-700 dark:text-gray-200">
                        <User size={13} className="shrink-0 text-gray-400" />
                        <span className="font-medium">
                          {u ? `${u.apellido}, ${u.nombre}` : 'Usuario eliminado / desconocido'}
                        </span>
                        {u?.dni && <span className="text-gray-500">· DNI {u.dni}</span>}
                        {u?.curso && <span className="text-gray-500">· Curso {u.curso}</span>}
                      </p>
                    </div>

                    <Badge variant={estadoPrestamoVariant(p.estado)}>{p.estado}</Badge>
                  </div>

                  {(horaRetiro || horaDevolucion) && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                      {horaRetiro && (
                        <span>
                          Retiro real: <strong className="font-medium text-gray-700 dark:text-gray-200">{horaRetiro} hs</strong>
                          {metEnt ? ` (${metEnt})` : ''}
                        </span>
                      )}
                      {horaDevolucion && (
                        <span>
                          Devolución real:{' '}
                          <strong className="font-medium text-gray-700 dark:text-gray-200">{horaDevolucion} hs</strong>
                          {metDev ? ` (${metDev})` : ''}
                        </span>
                      )}
                    </div>
                  )}

                  {(obsSalida || obsDevolucion) && (
                    <div className="mt-2.5 space-y-1 rounded-lg bg-gray-50 p-2.5 text-xs text-gray-700 dark:bg-gray-900/70 dark:text-gray-300">
                      {obsSalida && (
                        <p className="flex items-start gap-1.5">
                          <MessageSquareText size={13} className="mt-0.5 shrink-0 text-brand-600" />
                          <span>
                            <strong>Entrega:</strong> {obsSalida}
                          </span>
                        </p>
                      )}
                      {obsDevolucion && (
                        <p className="flex items-start gap-1.5">
                          <MessageSquareText size={13} className="mt-0.5 shrink-0 text-amber-600" />
                          <span>
                            <strong>Devolución:</strong> {obsDevolucion}
                          </span>
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ModalFrame>
  );
}
