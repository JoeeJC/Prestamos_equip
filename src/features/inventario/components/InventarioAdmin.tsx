import { useEffect, useState } from 'react';
import { AlertTriangle, Boxes, FileSpreadsheet, Plus } from 'lucide-react';
import { supabase } from '@/services/supabaseClient';
import type { Categoria, Equipo } from '@/types/database';
import { fechaLocalISO } from '@/utils/fechas';
import { verificarYCaducarReservasVencidas } from '@/features/prestamos/services/prestamosService';
import AgregarEquipoModal from '@/features/inventario/components/AgregarEquipoModal';
import EditarEquipoModal from '@/features/inventario/components/EditarEquipoModal';
import EliminarEquipoModal from '@/features/inventario/components/EliminarEquipoModal';
import HistorialEquipoModal from '@/features/inventario/components/HistorialEquipoModal';
import ImportarExcelEquiposModal from '@/features/inventario/components/ImportarExcelEquiposModal';
import InventarioEstadisticas from '@/features/inventario/components/InventarioEstadisticas';
import InventarioListado from '@/features/inventario/components/InventarioListado';
import InventarioStock from '@/features/inventario/components/InventarioStock';
import {
  calcularStockPorCategoria,
  type EstadoEditable,
  type EstadoEquipo,
  type FiltrosInventario,
} from '@/features/inventario/utils/inventario';

type Vista = 'stock' | 'listado' | 'estadisticas';
type Aviso = { tipo: 'exito' | 'error'; texto: string };

const FILTROS_INICIALES: FiltrosInventario = { texto: '', categoria: '', estado: '' };

export default function InventarioAdmin() {
  const [vista, setVista] = useState<Vista>('stock');
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [equipos, setEquipos] = useState<Equipo[] | null>(null);
  const [equiposReservadosIds, setEquiposReservadosIds] = useState<Set<string>>(() => new Set());
  const [totalReservasActivas, setTotalReservasActivas] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [filtros, setFiltros] = useState<FiltrosInventario>(FILTROS_INICIALES);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [actualizandoId, setActualizandoId] = useState<string | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [importandoExcel, setImportandoExcel] = useState(false);
  const [equipoEditando, setEquipoEditando] = useState<Equipo | null>(null);
  const [equipoEliminando, setEquipoEliminando] = useState<Equipo | null>(null);
  const [equipoHistorial, setEquipoHistorial] = useState<Equipo | null>(null);

  const mostrarAviso = (tipo: Aviso['tipo'], texto: string) => setAviso({ tipo, texto });

  const cargar = async () => {
    setCargando(true);
    await verificarYCaducarReservasVencidas().catch(() => {});
    const hoy = fechaLocalISO();
    const [{ data: cats, error: catsError }, { data: eqs, error: eqsError }, { data: resvs }] = await Promise.all([
      supabase.from('categorias_equipo').select('*').order('nombre'),
      supabase.from('equipos').select('*, categorias_equipo(*)').order('codigo_inventario'),
      supabase
        .from('prestamos')
        .select('id_prestamo, detalle_prestamos(id_equipo)')
        .eq('estado', 'Reservado')
        .gte('fecha_prestamo', hoy),
    ]);
    setCargando(false);
    if (catsError || eqsError) {
      mostrarAviso('error', 'No se pudo cargar el inventario. Intentá nuevamente.');
      return;
    }
    const listaEquipos = (eqs ?? []) as Equipo[];
    const listaReservas = (resvs ?? []) as { id_prestamo: string; detalle_prestamos?: { id_equipo: string }[] }[];
    const idsReservados = new Set<string>(
      listaEquipos.filter((e) => e.estado === 'Reservado').map((e) => e.id_equipo),
    );
    for (const r of listaReservas) {
      for (const d of r.detalle_prestamos ?? []) {
        if (d.id_equipo) idsReservados.add(d.id_equipo);
      }
    }

    setCategorias((cats ?? []) as Categoria[]);
    setEquipos(listaEquipos);
    setEquiposReservadosIds(idsReservados);
    setTotalReservasActivas(listaReservas.length);
  };

  useEffect(() => {
    cargar();
  }, []);

  useEffect(() => {
    if (!aviso) return;
    const temporizador = window.setTimeout(() => setAviso(null), 4000);
    return () => window.clearTimeout(temporizador);
  }, [aviso]);

  const cambiarEstado = async (equipo: Equipo, estado: EstadoEditable) => {
    if (estado === equipo.estado) return;
    setActualizandoId(equipo.id_equipo);
    const { error } = await supabase.from('equipos').update({ estado }).eq('id_equipo', equipo.id_equipo);
    setActualizandoId(null);
    if (error) {
      mostrarAviso('error', `No se pudo cambiar el estado de ${equipo.codigo_inventario}.`);
      return;
    }
    mostrarAviso('exito', `${equipo.codigo_inventario} ahora está en ${estado}.`);
    await cargar();
  };

  const verEstadoDeCategoria = (idCategoria: string, estado: EstadoEquipo) => {
    setFiltros({ texto: '', categoria: idCategoria, estado });
    setVista('listado');
  };

  const tabs: { id: Vista; label: string }[] = [
    { id: 'stock', label: 'Stock por categoría' },
    { id: 'listado', label: 'Listado de equipos' },
    { id: 'estadisticas', label: 'Estadísticas y reportes' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Inventario y stock</h2>
          <p className="text-sm text-gray-500">El stock se calcula a partir de los equipos cargados.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setImportandoExcel(true)}
            disabled={equipos === null}
            className="btn-secondary"
          >
            <FileSpreadsheet size={16} /> Importar Excel
          </button>
          <button type="button" onClick={() => setAgregando(true)} className="btn-primary">
            <Plus size={16} /> Agregar equipos
          </button>
        </div>
      </div>

      <div className="flex gap-1 rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-950 sm:w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setVista(t.id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              vista === t.id
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {equipos === null ? (
        cargando ? (
          <div className="card flex items-center justify-center gap-2 px-6 py-10 text-sm text-gray-500">
            <Boxes size={16} className="animate-pulse text-brand-600" />
            Cargando inventario…
          </div>
        ) : (
          <div className="card flex flex-col items-center gap-3 px-6 py-10 text-center text-sm text-gray-500">
            <AlertTriangle size={20} className="text-red-600" />
            <p>No se pudo cargar el inventario.</p>
            <button type="button" onClick={cargar} className="btn-secondary">
              Reintentar
            </button>
          </div>
        )
      ) : vista === 'stock' ? (
        <InventarioStock
          equipos={equipos}
          resumenes={calcularStockPorCategoria(categorias, equipos)}
          equiposReservadosIds={equiposReservadosIds}
          totalReservasActivas={totalReservasActivas}
          onVerEstado={verEstadoDeCategoria}
        />
      ) : vista === 'listado' ? (
        <InventarioListado
          equipos={equipos}
          categorias={categorias}
          equiposReservadosIds={equiposReservadosIds}
          filtros={filtros}
          onFiltrosChange={setFiltros}
          actualizandoId={actualizandoId}
          onCambiarEstado={cambiarEstado}
          onEditar={setEquipoEditando}
          onEliminar={setEquipoEliminando}
          onVerHistorial={setEquipoHistorial}
        />
      ) : (
        <InventarioEstadisticas categorias={categorias} equipos={equipos} />
      )}

      {agregando && (
        <AgregarEquipoModal
          categorias={categorias}
          onRecargar={cargar}
          onCerrar={() => setAgregando(false)}
          onGuardado={(mensaje) => {
            setAgregando(false);
            mostrarAviso('exito', mensaje);
            cargar();
          }}
        />
      )}

      {importandoExcel && equipos && (
        <ImportarExcelEquiposModal
          equiposExistentes={equipos}
          categorias={categorias}
          onCerrar={() => setImportandoExcel(false)}
          onImportado={(mensaje) => {
            mostrarAviso('exito', mensaje);
            void cargar();
          }}
        />
      )}

      {equipoEditando && (
        <EditarEquipoModal
          equipo={equipoEditando}
          categorias={categorias}
          onCerrar={() => setEquipoEditando(null)}
          onGuardado={(mensaje) => {
            setEquipoEditando(null);
            mostrarAviso('exito', mensaje);
            cargar();
          }}
        />
      )}

      {equipoEliminando && (
        <EliminarEquipoModal
          equipo={equipoEliminando}
          onCerrar={() => setEquipoEliminando(null)}
          onCompletado={(mensaje) => {
            setEquipoEliminando(null);
            mostrarAviso('exito', mensaje);
            cargar();
          }}
        />
      )}

      {equipoHistorial && (
        <HistorialEquipoModal equipo={equipoHistorial} onCerrar={() => setEquipoHistorial(null)} />
      )}

      {aviso && (
        <div
          role="status"
          className={`fixed bottom-6 right-4 z-[60] max-w-sm rounded-lg px-4 py-3 text-sm font-medium shadow-card ${
            aviso.tipo === 'exito'
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white'
          }`}
        >
          {aviso.texto}
        </div>
      )}
    </div>
  );
}
