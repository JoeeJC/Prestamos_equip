import { History, Pencil, Trash2 } from 'lucide-react';
import Badge, { estadoEquipoVariant } from '@/components/ui/Badge';
import {
  coincideBusqueda, estadoBloqueado, ESTADOS_EDITABLES, ESTADOS_EQUIPO, EstadoEditable, FiltrosInventario, } from '@/features/inventario/utils/inventario';
import type { Categoria, Equipo } from '@/types/database';

export default function InventarioListado({
  equipos,
  categorias,
  equiposReservadosIds,
  filtros,
  onFiltrosChange,
  actualizandoId,
  onCambiarEstado,
  onEditar,
  onEliminar,
  onVerHistorial,
}: {
  equipos: Equipo[];
  categorias: Categoria[];
  equiposReservadosIds: Set<string>;
  filtros: FiltrosInventario;
  onFiltrosChange: (filtros: FiltrosInventario) => void;
  actualizandoId: string | null;
  onCambiarEstado: (equipo: Equipo, estado: EstadoEditable) => void;
  onEditar: (equipo: Equipo) => void;
  onEliminar: (equipo: Equipo) => void;
  onVerHistorial: (equipo: Equipo) => void;
}) {
  const visibles = equipos.filter(
    (equipo) =>
      coincideBusqueda(equipo, filtros.texto) &&
      (!filtros.categoria || equipo.id_categoria === filtros.categoria) &&
      (!filtros.estado ||
        equipo.estado === filtros.estado ||
        (filtros.estado === 'Reservado' && equiposReservadosIds.has(equipo.id_equipo))),
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <input
          className="input"
          placeholder="Buscar por código, serie o marca..."
          value={filtros.texto}
          onChange={(e) => onFiltrosChange({ ...filtros, texto: e.target.value })}
        />
        <select
          className="input"
          value={filtros.categoria}
          onChange={(e) => onFiltrosChange({ ...filtros, categoria: e.target.value })}
        >
          <option value="">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c.id_categoria} value={c.id_categoria}>
              {c.nombre}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={filtros.estado}
          onChange={(e) => onFiltrosChange({ ...filtros, estado: e.target.value as FiltrosInventario['estado'] })}
        >
          <option value="">Todos los estados</option>
          {ESTADOS_EQUIPO.map((estado) => (
            <option key={estado} value={estado}>
              {estado}
            </option>
          ))}
        </select>
      </div>

      {visibles.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-gray-500">
          No hay equipos que coincidan con los filtros.
        </div>
      ) : (
        <ul className="card divide-y divide-gray-100 dark:divide-gray-800">
          {visibles.map((equipo) => {
            const bloqueado = estadoBloqueado(equipo.estado);
            const ocupado = actualizandoId === equipo.id_equipo;
            const tieneReserva = equiposReservadosIds.has(equipo.id_equipo) && equipo.estado !== 'Reservado';
            return (
              <li key={equipo.id_equipo} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-gray-900 dark:text-white">{equipo.codigo_inventario}</p>
                    {tieneReserva && <Badge variant="yellow">Con reserva</Badge>}
                    {equipo.oculto_catalogo && <Badge variant="gray">Oculto en catálogo</Badge>}
                  </div>
                  <p className="truncate text-xs text-gray-500">
                    {equipo.categorias_equipo?.nombre ?? 'Sin categoría'} · {equipo.marca_modelo ?? '—'}
                    {equipo.numero_serie ? ` · Serie ${equipo.numero_serie}` : ''}
                    {equipo.observaciones ? ` · ${equipo.observaciones}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {bloqueado ? (
                    <Badge variant={estadoEquipoVariant(equipo.estado)}>{equipo.estado}</Badge>
                  ) : (
                    <select
                      className="input h-9 w-auto py-1 text-sm"
                      value={equipo.estado}
                      disabled={ocupado}
                      onChange={(e) => onCambiarEstado(equipo, e.target.value as EstadoEditable)}
                      aria-label={`Estado de ${equipo.codigo_inventario}`}
                    >
                      {ESTADOS_EDITABLES.map((estado) => (
                        <option key={estado} value={estado}>
                          {estado}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={() => onVerHistorial(equipo)}
                    className="btn-ghost h-9 w-9 !px-0"
                    aria-label={`Ver historial de ${equipo.codigo_inventario}`}
                    title="Ver historial de préstamos"
                  >
                    <History size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onEditar(equipo)}
                    className="btn-ghost h-9 w-9 !px-0"
                    aria-label={`Editar ${equipo.codigo_inventario}`}
                    title="Editar equipo"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onEliminar(equipo)}
                    disabled={bloqueado}
                    className="btn-ghost h-9 w-9 !px-0 text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={`Eliminar ${equipo.codigo_inventario}`}
                    title={bloqueado ? 'No se puede eliminar un equipo reservado o en préstamo' : 'Eliminar'}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
