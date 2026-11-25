import { AlertTriangle } from 'lucide-react';
import Badge, { estadoEquipoVariant } from '@/components/ui/Badge';
import { conteosPorEstado, ESTADOS_EQUIPO, EstadoEquipo, ResumenCategoria } from '@/features/inventario/utils/inventario';
import type { Equipo } from '@/types/database';

const COLOR_BARRA: Record<EstadoEquipo, string> = {
  Disponible: 'bg-green-500',
  Reservado: 'bg-amber-400',
  'En préstamo': 'bg-brand-500',
  'En mantenimiento': 'bg-purple-500',
  Baja: 'bg-red-400',
};

export default function InventarioStock({
  equipos,
  resumenes,
  equiposReservadosIds,
  totalReservasActivas,
  onVerEstado,
}: {
  equipos: Equipo[];
  resumenes: ResumenCategoria[];
  equiposReservadosIds: Set<string>;
  totalReservasActivas: number;
  onVerEstado: (idCategoria: string, estado: EstadoEquipo) => void;
}) {
  const globales = conteosPorEstado(equipos);
  const ocultosDisponibles = equipos.filter(
    (eq) => eq.estado === 'Disponible' && Boolean(eq.oculto_catalogo),
  ).length;
  const reservadosPorCategoria = new Map<string, number>();
  for (const eq of equipos) {
    if (equiposReservadosIds.has(eq.id_equipo)) {
      reservadosPorCategoria.set(eq.id_categoria, (reservadosPorCategoria.get(eq.id_categoria) ?? 0) + 1);
    }
  }

  const tarjetas: { label: string; valor: number; detalle?: string }[] = [
    { label: 'Total', valor: equipos.length },
    {
      label: 'Disponibles',
      valor: globales.Disponible,
      detalle:
        ocultosDisponibles > 0
          ? `${ocultosDisponibles} ${ocultosDisponibles === 1 ? 'oculta' : 'ocultas'} en catálogo`
          : undefined,
    },
    {
      label: 'Reservados',
      valor: equiposReservadosIds.size,
      detalle:
        totalReservasActivas > 0
          ? `${totalReservasActivas} ${totalReservasActivas === 1 ? 'reserva vigente' : 'reservas vigentes'}`
          : undefined,
    },
    { label: 'En préstamo', valor: globales['En préstamo'] },
    { label: 'En mantenimiento', valor: globales['En mantenimiento'] },
    { label: 'Dados de baja', valor: globales.Baja },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tarjetas.map((t) => (
          <div key={t.label} className="card p-4">
            <p className="text-xs font-medium text-gray-500">{t.label}</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{t.valor}</p>
            {t.detalle && (
              <p className="mt-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">{t.detalle}</p>
            )}
          </div>
        ))}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-100">Stock por categoría</h3>
        {resumenes.length === 0 ? (
          <div className="card px-6 py-10 text-center text-sm text-gray-500">Todavía no hay categorías cargadas.</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {resumenes.map((r) => (
              <div key={r.id_categoria} className="card space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-gray-900 dark:text-white">{r.nombre}</p>
                    <p className="text-xs text-gray-500">
                      {r.disponibles} disponibles / {r.sinBaja} total sin Baja
                      {r.ocultos > 0 ? ` · ${r.ocultos} ocultas en catálogo` : ''}
                    </p>
                  </div>
                  {r.alerta === 'sin-stock' && (
                    <Badge variant="red" className="shrink-0 gap-1">
                      <AlertTriangle size={12} /> Sin stock
                    </Badge>
                  )}
                  {r.alerta === 'stock-bajo' && (
                    <Badge variant="yellow" className="shrink-0 gap-1">
                      <AlertTriangle size={12} /> Stock bajo
                    </Badge>
                  )}
                </div>

                {r.total > 0 && (
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    {ESTADOS_EQUIPO.map((estado) =>
                      r.conteos[estado] > 0 ? (
                        <div
                          key={estado}
                          className={`h-full ${COLOR_BARRA[estado]}`}
                          style={{ width: `${(r.conteos[estado] / r.total) * 100}%` }}
                          title={`${estado}: ${r.conteos[estado]}`}
                        />
                      ) : null,
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {ESTADOS_EQUIPO.map((estado) => {
                    const conteo =
                      estado === 'Reservado'
                        ? reservadosPorCategoria.get(r.id_categoria) ?? r.conteos.Reservado
                        : r.conteos[estado];
                    return (
                      <button
                        key={estado}
                        type="button"
                        onClick={() => onVerEstado(r.id_categoria, estado)}
                        className="rounded-full transition hover:opacity-80"
                        title={`Ver ${estado} en ${r.nombre}`}
                      >
                        <Badge variant={estadoEquipoVariant(estado)}>
                          {estado} · {conteo}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
