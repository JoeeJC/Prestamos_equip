import { AlertTriangle } from 'lucide-react';
import Badge, { estadoEquipoVariant } from '@/components/Badge';
import { conteosPorEstado, ESTADOS_EQUIPO, type EstadoEquipo, type ResumenCategoria } from '@/lib/inventario';
import type { Equipo } from '@/lib/supabase';

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
  onVerEstado,
}: {
  equipos: Equipo[];
  resumenes: ResumenCategoria[];
  onVerEstado: (idCategoria: string, estado: EstadoEquipo) => void;
}) {
  const globales = conteosPorEstado(equipos);
  const tarjetas = [
    { label: 'Total', valor: equipos.length },
    { label: 'Disponibles', valor: globales.Disponible },
    { label: 'Reservados y en préstamo', valor: globales.Reservado + globales['En préstamo'] },
    { label: 'En mantenimiento', valor: globales['En mantenimiento'] },
    { label: 'Dados de baja', valor: globales.Baja },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tarjetas.map((t) => (
          <div key={t.label} className="card p-4">
            <p className="text-xs font-medium text-gray-500">{t.label}</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{t.valor}</p>
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
                  {ESTADOS_EQUIPO.map((estado) => (
                    <button
                      key={estado}
                      type="button"
                      onClick={() => onVerEstado(r.id_categoria, estado)}
                      className="rounded-full transition hover:opacity-80"
                      title={`Ver ${estado} en ${r.nombre}`}
                    >
                      <Badge variant={estadoEquipoVariant(estado)}>
                        {estado} · {r.conteos[estado]}
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
