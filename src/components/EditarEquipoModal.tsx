import { useState } from 'react';
import ModalFrame from '@/components/ModalFrame';
import { supabase, type Categoria, type Equipo } from '@/lib/supabase';
import { esErrorDePostgres } from '@/lib/inventario';

export default function EditarEquipoModal({
  equipo,
  categorias,
  onCerrar,
  onGuardado,
}: {
  equipo: Equipo;
  categorias: Categoria[];
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}) {
  const [codigo, setCodigo] = useState(equipo.codigo_inventario);
  const [categoriaId, setCategoriaId] = useState(equipo.id_categoria);
  const [marca, setMarca] = useState(equipo.marca_modelo ?? '');
  const [serie, setSerie] = useState(equipo.numero_serie ?? '');
  const [observaciones, setObservaciones] = useState(equipo.observaciones ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const guardar = async () => {
    const codigoLimpio = codigo.trim();
    if (!codigoLimpio) {
      setError('Ingresá el código de inventario.');
      return;
    }
    setGuardando(true);
    setError('');
    const { error: updateError } = await supabase
      .from('equipos')
      .update({
        codigo_inventario: codigoLimpio,
        id_categoria: categoriaId,
        marca_modelo: marca.trim() || null,
        numero_serie: serie.trim() || null,
        observaciones: observaciones.trim() || null,
      })
      .eq('id_equipo', equipo.id_equipo);
    setGuardando(false);

    if (updateError) {
      setError(
        esErrorDePostgres(updateError, '23505')
          ? 'Ya existe un equipo con ese código'
          : 'No se pudieron guardar los cambios. Intentá nuevamente.',
      );
      return;
    }
    onGuardado(`Equipo ${codigoLimpio} actualizado`);
  };

  const campo = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

  return (
    <ModalFrame
      titulo={`Editar ${equipo.codigo_inventario}`}
      onCerrar={onCerrar}
      footer={
        <>
          <button type="button" onClick={onCerrar} className="btn-ghost">
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={guardando} className="btn-primary">
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={campo}>Código de inventario</label>
            <input className="input" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          </div>
          <div>
            <label className={campo}>Categoría</label>
            <select className="input" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
              {categorias.map((c) => (
                <option key={c.id_categoria} value={c.id_categoria}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={campo}>Marca y modelo</label>
            <input className="input" value={marca} onChange={(e) => setMarca(e.target.value)} />
          </div>
          <div>
            <label className={campo}>Número de serie</label>
            <input className="input" value={serie} onChange={(e) => setSerie(e.target.value)} />
          </div>
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
