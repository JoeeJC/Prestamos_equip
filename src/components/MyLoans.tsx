import { useEffect, useState } from 'react';
import { Inbox, Calendar, Clock, X } from 'lucide-react';
import { supabase, type DetallePrestamo, type Prestamo } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import Badge, { estadoPrestamoVariant } from '@/components/Badge';

type PrestamoConDetalle = Prestamo & { detalle_prestamos?: DetallePrestamo[] };

export default function MyLoans({ refreshKey }: { refreshKey?: number }) {
  const { session } = useAuth();
  const [prestamos, setPrestamos] = useState<PrestamoConDetalle[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    if (!session) return;
    setLoading(true);
    const { data } = await supabase
      .from('prestamos')
      .select('*, detalle_prestamos(*, equipos(*, categorias_equipo(*)))')
      .eq('id_usuario', session.usuario.id_usuario)
      .order('fecha_prestamo', { ascending: false })
      .order('hora_inicio_prevista', { ascending: false });
    setPrestamos((data ?? []) as PrestamoConDetalle[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, refreshKey]);

  const cancelar = async (p: PrestamoConDetalle) => {
    if (!confirm('¿Cancelar esta reserva? Los equipos volverán a estar disponibles.')) return;
    setBusy(p.id_prestamo);
    try {
      await supabase.from('prestamos').update({ estado: 'Cancelado' }).eq('id_prestamo', p.id_prestamo);
      const ids = (p.detalle_prestamos ?? []).map((d) => d.id_equipo);
      if (ids.length) {
        await supabase.from('equipos').update({ estado: 'Disponible' }).in('id_equipo', ids);
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20 text-gray-500">Cargando tus préstamos…</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Mis préstamos y reservas</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Historial de tus reservas. Podés cancelar las que estén pendientes.
        </p>
      </div>

      {prestamos.length === 0 ? (
        <div className="card flex flex-col items-center justify-center px-6 py-16 text-center">
          <Inbox size={36} className="mb-3 text-gray-300" />
          <p className="text-sm text-gray-500">Todavía no tenés préstamos ni reservas.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {prestamos.map((p) => (
            <div key={p.id_prestamo} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant={estadoPrestamoVariant(p.estado)}>{p.estado}</Badge>
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
                    {p.hora_inicio_prevista.slice(0, 5)} a {p.hora_fin_prevista.slice(0, 5)} hs
                  </p>
                </div>
                {(p.estado === 'Reservado' || p.estado === 'En Curso') && (
                  <button
                    type="button"
                    disabled={busy === p.id_prestamo}
                    onClick={() => cancelar(p)}
                    className="btn-danger"
                  >
                    <X size={15} /> {busy === p.id_prestamo ? 'Cancelando…' : 'Cancelar'}
                  </button>
                )}
              </div>

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
          ))}
        </div>
      )}
    </div>
  );
}
