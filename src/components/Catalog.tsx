import { useEffect, useMemo, useState } from 'react';
import { Search, Package } from 'lucide-react';
import { supabase, type Categoria, type Equipo } from '@/lib/supabase';
import { verificarYCaducarReservasVencidas } from '@/lib/prestamos';
import Badge, { estadoEquipoVariant } from '@/components/Badge';

export default function Catalog({
  onReserve,
}: {
  onReserve: (equipo: Equipo) => void;
}) {
  const [equipos, setEquipos] = useState<Equipo[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('all');
  const [estado, setEstado] = useState<string>('all');

  useEffect(() => {
    let active = true;
    (async () => {
      await verificarYCaducarReservasVencidas().catch(() => undefined);
      const [{ data: e }, { data: c }] = await Promise.all([
        supabase.from('equipos').select('*, categorias_equipo(*)').order('codigo_inventario'),
        supabase.from('categorias_equipo').select('*').order('nombre'),
      ]);
      if (!active) return;
      setEquipos((e ?? []) as Equipo[]);
      setCategorias((c ?? []) as Categoria[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return equipos.filter((eq) => {
      if (cat !== 'all' && eq.id_categoria !== cat) return false;
      if (estado !== 'all' && eq.estado !== estado) return false;
      if (!query) return true;
      const hay = [eq.codigo_inventario, eq.numero_serie, eq.marca_modelo, eq.observaciones, eq.categorias_equipo?.nombre]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(query);
    });
  }, [equipos, q, cat, estado]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        Cargando catálogo…
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Catálogo de equipos</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Buscá y reservá equipos disponibles para tu día de clases.
        </p>
      </div>

      <div className="card mb-5 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-gray-400" />
            <input
              className="input pl-9"
              placeholder="Buscar por código, serie, marca…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select className="input sm:w-48" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="all">Todas las categorías</option>
            {categorias.map((c) => (
              <option key={c.id_categoria} value={c.id_categoria}>
                {c.nombre}
              </option>
            ))}
          </select>
          <select className="input sm:w-44" value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="all">Todos los estados</option>
            <option value="Disponible">Disponible</option>
            <option value="Reservado">Reservado</option>
            <option value="En préstamo">En préstamo</option>
            <option value="En mantenimiento">En mantenimiento</option>
            <option value="Baja">Baja</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card flex flex-col items-center justify-center px-6 py-16 text-center">
          <Package size={36} className="mb-3 text-gray-300" />
          <p className="text-sm text-gray-500">No se encontraron equipos con esos filtros.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((eq) => (
            <div key={eq.id_equipo} className="card flex flex-col p-4 transition hover:shadow-card">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-brand-600 dark:text-brand-300">
                    {eq.categorias_equipo?.nombre ?? '—'}
                  </p>
                  <p className="mt-0.5 font-semibold text-gray-900 dark:text-white">
                    {eq.codigo_inventario}
                  </p>
                </div>
                <Badge variant={estadoEquipoVariant(eq.estado)}>{eq.estado}</Badge>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-200">{eq.marca_modelo ?? '—'}</p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Serie: {eq.numero_serie ?? '—'}
              </p>
              {eq.observaciones && (
                <p className="mt-2 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                  {eq.observaciones}
                </p>
              )}
              <div className="mt-auto pt-4">
                <button
                  type="button"
                  disabled={eq.estado !== 'Disponible'}
                  onClick={() => onReserve(eq)}
                  className="btn-primary w-full"
                >
                  {eq.estado === 'Disponible' ? 'Reservar' : 'No disponible'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
