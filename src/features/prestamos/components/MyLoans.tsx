import { useEffect, useMemo, useState } from 'react';
import {
  Calendar, ChevronDown, ChevronUp, Clock, History, Inbox, QrCode, ShieldCheck, X, } from 'lucide-react';
import { supabase } from '@/services/supabaseClient';
import type { DetallePrestamo, Prestamo } from '@/types/database';
import { useAuth } from '@/context/AuthContext';
import {
  esPrestamoActivoOPendiente,
  ordenarPrestamosPorPrioridad,
  verificarYCaducarReservasVencidas,
} from '@/features/prestamos/services/prestamosService';
import { etiquetaMetodoDevolucion, etiquetaMetodoEntrega } from '@/features/prestamos/services/qrRetiroService';
import Badge, { estadoPrestamoVariant } from '@/components/ui/Badge';
import QrRetiroModal from '@/features/prestamos/components/QrRetiroModal';

type PrestamoConDetalle = Prestamo & { detalle_prestamos?: DetallePrestamo[] };

export default function MyLoans({ refreshKey }: { refreshKey?: number }) {
  const { session } = useAuth();
  const [prestamos, setPrestamos] = useState<PrestamoConDetalle[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [errorAviso, setErrorAviso] = useState<string | null>(null);
  const [qrPrestamo, setQrPrestamo] = useState<PrestamoConDetalle | null>(null);
  const [mostrarHistorial, setMostrarHistorial] = useState(false);

  const load = async () => {
    if (!session) return;
    setLoading(true);
    await verificarYCaducarReservasVencidas().catch(() => undefined);
    const { data } = await supabase
      .from('prestamos')
      .select('*, detalle_prestamos(*, equipos(*, categorias_equipo(*)))')
      .eq('id_usuario', session.usuario.id_usuario)
      .order('fecha_prestamo', { ascending: false })
      .order('hora_inicio_prevista', { ascending: false });
    const ordenados = ordenarPrestamosPorPrioridad((data ?? []) as PrestamoConDetalle[]);
    setPrestamos(ordenados);
    const tieneActivos = ordenados.some((p) => esPrestamoActivoOPendiente(p.estado));
    setMostrarHistorial(!tieneActivos);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, refreshKey]);

  const { activos, historial } = useMemo(() => {
    const act: PrestamoConDetalle[] = [];
    const hist: PrestamoConDetalle[] = [];
    for (const p of prestamos) {
      if (esPrestamoActivoOPendiente(p.estado)) act.push(p);
      else hist.push(p);
    }
    return { activos: act, historial: hist };
  }, [prestamos]);

  const cancelar = async (p: PrestamoConDetalle) => {
    if (p.estado !== 'Reservado') return;
    setBusy(p.id_prestamo);
    setErrorAviso(null);
    try {
      const { error } = await supabase
        .from('prestamos')
        .update({ estado: 'Cancelado' })
        .eq('id_prestamo', p.id_prestamo)
        .eq('estado', 'Reservado');
      if (error) throw new Error(error.message);
      setConfirmandoId(null);
      await load();
    } catch (err) {
      setErrorAviso(err instanceof Error ? err.message : 'No se pudo cancelar la reserva.');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20 text-gray-500">Cargando tus préstamos…</div>;
  }

  const renderCard = (p: PrestamoConDetalle) => {
    const confirmacionEntrega = etiquetaMetodoEntrega(p.metodo_entrega);
    const confirmacionDevolucion = etiquetaMetodoDevolucion(p.metodo_devolucion);
    const esRetiroODevolucion = p.estado === 'Reservado' || p.estado === 'En Curso';
    const esDevolucion = p.estado === 'En Curso';
    const bordePrioridad =
      p.estado === 'En Curso'
        ? 'border-l-4 border-blue-600 bg-blue-50/30 dark:bg-blue-950/10'
        : p.estado === 'Reservado'
          ? 'border-l-4 border-amber-500 bg-amber-50/30 dark:bg-amber-950/10'
          : '';

    return (
      <div key={p.id_prestamo} className={`card p-4 ${bordePrioridad}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={estadoPrestamoVariant(p.estado)}>{p.estado}</Badge>
              {confirmacionEntrega && (
                <Badge variant="green">
                  <ShieldCheck size={12} /> {confirmacionEntrega}
                </Badge>
              )}
              {confirmacionDevolucion && (
                <Badge variant="green">
                  <ShieldCheck size={12} /> {confirmacionDevolucion}
                </Badge>
              )}
              <span className="text-xs text-gray-500">
                Solicitado {new Date(p.fecha_solicitud).toLocaleDateString('es-AR')}
              </span>
            </div>
            <p className="mt-2 flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
              <Calendar size={15} className="text-brand-600" />
              {new Date(p.fecha_prestamo + 'T00:00:00').toLocaleDateString('es-AR', {
                weekday: 'long',
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </p>
            <p className="mt-1 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <Clock size={15} className="text-brand-600" />
              {p.retiro_desde && p.retiro_hasta
                ? `Retiro ${p.retiro_desde.slice(0, 5)}–${p.retiro_hasta.slice(0, 5)} hs · Devolución ${p.hora_fin_prevista.slice(0, 5)} hs`
                : `${p.hora_inicio_prevista.slice(0, 5)} a ${p.hora_fin_prevista.slice(0, 5)} hs`}
            </p>
            {esRetiroODevolucion && p.codigo_retiro && (
              <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-300">
                {esDevolucion ? 'Código para devolución:' : 'Código de retiro:'}{' '}
                <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono font-bold tracking-wider text-gray-900 dark:bg-gray-800 dark:text-white">
                  {p.codigo_retiro}
                </span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {esRetiroODevolucion && p.codigo_retiro && (
              <button
                type="button"
                onClick={() => setQrPrestamo(p)}
                className="btn-primary flex-1 sm:flex-initial"
              >
                <QrCode size={15} /> {esDevolucion ? 'Mostrar QR de devolución' : 'Mostrar QR de retiro'}
              </button>
            )}
            {p.estado === 'Reservado' && confirmandoId !== p.id_prestamo && (
              <button
                type="button"
                disabled={busy === p.id_prestamo}
                onClick={() => setConfirmandoId(p.id_prestamo)}
                className="btn-danger"
              >
                <X size={15} /> Cancelar
              </button>
            )}
          </div>
        </div>

        {p.estado === 'Reservado' && confirmandoId === p.id_prestamo && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            <span className="font-medium">
              ¿Cancelar esta reserva? Los equipos volverán a quedar disponibles para otros usuarios.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy === p.id_prestamo}
                onClick={() => setConfirmandoId(null)}
                className="btn-secondary h-8 px-2.5 text-xs"
              >
                Mantener
              </button>
              <button
                type="button"
                disabled={busy === p.id_prestamo}
                onClick={() => void cancelar(p)}
                className="btn-danger h-8 px-2.5 text-xs"
              >
                {busy === p.id_prestamo ? 'Cancelando…' : 'Sí, cancelar'}
              </button>
            </div>
          </div>
        )}

        {p.detalle_prestamos && p.detalle_prestamos.length > 0 && (
          <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-800">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Equipos
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {p.detalle_prestamos.map((d) => (
                <li
                  key={d.id_detalle}
                  className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-800"
                >
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {d.equipos?.codigo_inventario}
                  </p>
                  <p className="text-xs text-gray-500">
                    {d.equipos?.categorias_equipo?.nombre} · {d.equipos?.marca_modelo ?? '—'}
                  </p>
                  {d.estado_salida && (
                    <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                      Salida: {d.estado_salida}
                    </p>
                  )}
                  {d.estado_devolucion && (
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      Devolución: {d.estado_devolucion}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(p.observaciones_entrega || p.observaciones_devolucion) && (
          <div className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-xs text-gray-600 dark:border-gray-800 dark:text-gray-400">
            {p.observaciones_entrega && (
              <p>
                <span className="font-semibold">Obs. entrega:</span> {p.observaciones_entrega}
              </p>
            )}
            {p.observaciones_devolucion && (
              <p>
                <span className="font-semibold">Obs. devolución:</span>{' '}
                {p.observaciones_devolucion}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Mis préstamos y reservas</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Tus reservas activas y próximas aparecen primero para acceder rápido al QR.
        </p>
      </div>

      {errorAviso && (
        <div
          role="alert"
          className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
        >
          <span>{errorAviso}</span>
          <button
            type="button"
            onClick={() => setErrorAviso(null)}
            className="btn-ghost h-7 w-7 shrink-0 !px-0"
            aria-label="Cerrar error"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {prestamos.length === 0 ? (
        <div className="card flex flex-col items-center justify-center px-6 py-16 text-center">
          <Inbox size={36} className="mb-3 text-gray-300" />
          <p className="text-sm text-gray-500">Todavía no tenés préstamos ni reservas.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {activos.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-200">
                  <QrCode size={15} className="text-brand-600" />
                  Activos y próximos
                  <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
                    {activos.length}
                  </span>
                </h2>
              </div>
              <div className="space-y-3">{activos.map(renderCard)}</div>
            </section>
          )}

          {historial.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between border-t border-gray-200 pt-4 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setMostrarHistorial((prev) => !prev)}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800/60"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                    <History size={15} className="text-gray-500" />
                    Historial
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      {historial.length}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400">
                    {mostrarHistorial ? (
                      <>
                        Ocultar <ChevronUp size={15} />
                      </>
                    ) : (
                      <>
                        Mostrar <ChevronDown size={15} />
                      </>
                    )}
                  </span>
                </button>
              </div>
              {mostrarHistorial && <div className="space-y-3">{historial.map(renderCard)}</div>}
            </section>
          )}
        </div>
      )}

      {qrPrestamo && session && (
        <QrRetiroModal
          prestamo={qrPrestamo}
          nombreUsuario={`${session.usuario.nombre} ${session.usuario.apellido} · DNI ${session.usuario.dni}`}
          onCerrar={() => setQrPrestamo(null)}
          onActualizar={() => void load()}
        />
      )}
    </div>
  );
}
