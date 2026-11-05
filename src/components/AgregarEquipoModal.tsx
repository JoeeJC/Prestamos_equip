import { useState } from 'react';
import { Plus } from 'lucide-react';
import ModalFrame from '@/components/ModalFrame';
import { supabase, type Categoria } from '@/lib/supabase';
import { esErrorDePostgres, generarCodigos, ESTADOS_EDITABLES, type EstadoEditable } from '@/lib/inventario';

const CANTIDAD_MAXIMA = 100;

export default function AgregarEquipoModal({
  categorias,
  onRecargar,
  onCerrar,
  onGuardado,
}: {
  categorias: Categoria[];
  onRecargar: () => Promise<void>;
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}) {
  const [categoriaId, setCategoriaId] = useState('');
  const [mostrarNueva, setMostrarNueva] = useState(false);
  const [nuevaCategoria, setNuevaCategoria] = useState('');
  const [creandoCategoria, setCreandoCategoria] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [marca, setMarca] = useState('');
  const [serie, setSerie] = useState('');
  const [estadoInicial, setEstadoInicial] = useState<EstadoEditable>('Disponible');
  const [observaciones, setObservaciones] = useState('');
  const [cantidad, setCantidad] = useState(1);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const varias = cantidad > 1;

  const crearCategoria = async () => {
    const nombre = nuevaCategoria.trim();
    if (!nombre) {
      setError('Escribí el nombre de la categoría.');
      return;
    }
    setCreandoCategoria(true);
    const { data, error: categoriaError } = await supabase
      .from('categorias_equipo')
      .insert({ nombre })
      .select('id_categoria')
      .single();
    setCreandoCategoria(false);
    if (categoriaError || !data) {
      setError('No se pudo crear la categoría.');
      return;
    }
    setCategoriaId(data.id_categoria);
    setNuevaCategoria('');
    setMostrarNueva(false);
    setError('');
    await onRecargar();
  };

  const guardar = async () => {
    setError('');
    const base = codigo.trim();
    if (!categoriaId) {
      setError('Elegí una categoría.');
      return;
    }
    if (!base) {
      setError('Ingresá el código de inventario.');
      return;
    }
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > CANTIDAD_MAXIMA) {
      setError(`La cantidad debe estar entre 1 y ${CANTIDAD_MAXIMA}.`);
      return;
    }
    const codigos = generarCodigos(base, cantidad);
    if (!codigos) {
      setError('Para cargar varias unidades el código debe terminar en número, por ejemplo NB-007.');
      return;
    }

    setGuardando(true);
    const filas = codigos.map((codigo_inventario) => ({
      id_categoria: categoriaId,
      codigo_inventario,
      numero_serie: varias ? null : serie.trim() || null,
      marca_modelo: marca.trim() || null,
      estado: estadoInicial,
      observaciones: observaciones.trim() || null,
    }));
    const { error: insertError } = await supabase.from('equipos').insert(filas);
    setGuardando(false);

    if (insertError) {
      setError(
        esErrorDePostgres(insertError, '23505')
          ? 'Ya existe un equipo con ese código'
          : 'No se pudieron guardar los equipos. Intentá nuevamente.',
      );
      return;
    }
    onGuardado(varias ? `${cantidad} equipos agregados` : `Equipo ${base} agregado`);
  };

  const campo = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

  return (
    <ModalFrame
      titulo="Agregar equipos"
      onCerrar={onCerrar}
      footer={
        <>
          <button type="button" onClick={onCerrar} className="btn-ghost">
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={guardando} className="btn-primary">
            {guardando ? 'Guardando…' : varias ? `Agregar ${cantidad} equipos` : 'Agregar equipo'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={campo}>Categoría</label>
          <div className="flex gap-2">
            <select className="input flex-1" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
              <option value="">Seleccioná una categoría</option>
              {categorias.map((c) => (
                <option key={c.id_categoria} value={c.id_categoria}>
                  {c.nombre}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => setMostrarNueva((v) => !v)} className="btn-secondary">
              <Plus size={15} /> Nueva
            </button>
          </div>
          {mostrarNueva && (
            <div className="mt-2 flex gap-2">
              <input
                className="input flex-1"
                placeholder="Nombre de la categoría"
                value={nuevaCategoria}
                onChange={(e) => setNuevaCategoria(e.target.value)}
              />
              <button type="button" onClick={crearCategoria} disabled={creandoCategoria} className="btn-primary">
                {creandoCategoria ? 'Creando…' : 'Crear'}
              </button>
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={campo}>Código de inventario</label>
            <input className="input" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ej: NB-007" />
          </div>
          <div>
            <label className={campo}>Cantidad</label>
            <input
              className="input"
              type="number"
              min={1}
              max={CANTIDAD_MAXIMA}
              value={cantidad}
              onChange={(e) => setCantidad(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={campo}>Marca y modelo</label>
            <input className="input" value={marca} onChange={(e) => setMarca(e.target.value)} />
          </div>
          <div>
            <label className={campo}>Número de serie</label>
            <input
              className="input disabled:opacity-50"
              value={varias ? '' : serie}
              onChange={(e) => setSerie(e.target.value)}
              disabled={varias}
              placeholder={varias ? 'No aplica con varias unidades' : ''}
            />
          </div>
        </div>

        <div>
          <label className={campo}>Estado inicial</label>
          <select
            className="input"
            value={estadoInicial}
            onChange={(e) => setEstadoInicial(e.target.value as EstadoEditable)}
          >
            {ESTADOS_EDITABLES.map((estado) => (
              <option key={estado} value={estado}>
                {estado}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={campo}>Observaciones</label>
          <textarea className="input min-h-20" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>
        )}
      </div>
    </ModalFrame>
  );
}
