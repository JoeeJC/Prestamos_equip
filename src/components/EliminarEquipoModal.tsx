import { useState } from 'react';
import ModalFrame from '@/components/ModalFrame';
import { supabase, type Equipo } from '@/lib/supabase';
import { esErrorDePostgres } from '@/lib/inventario';

const MENSAJE_HISTORIAL = 'Este equipo tiene préstamos en su historial y no se puede eliminar';

export default function EliminarEquipoModal({
  equipo,
  onCerrar,
  onCompletado,
}: {
  equipo: Equipo;
  onCerrar: () => void;
  onCompletado: (mensaje: string) => void;
}) {
  const [procesando, setProcesando] = useState(false);
  const [tieneHistorial, setTieneHistorial] = useState(false);
  const [error, setError] = useState('');

  const eliminar = async () => {
    setProcesando(true);
    setError('');
    const { error: deleteError } = await supabase.from('equipos').delete().eq('id_equipo', equipo.id_equipo);
    setProcesando(false);
    if (!deleteError) {
      onCompletado(`Equipo ${equipo.codigo_inventario} eliminado`);
      return;
    }
    if (esErrorDePostgres(deleteError, '23503')) {
      setTieneHistorial(true);
      return;
    }
    setError('No se pudo eliminar el equipo. Intentá nuevamente.');
  };

  const darDeBaja = async () => {
    setProcesando(true);
    setError('');
    const { error: updateError } = await supabase
      .from('equipos')
      .update({ estado: 'Baja' })
      .eq('id_equipo', equipo.id_equipo);
    setProcesando(false);
    if (updateError) {
      setError('No se pudo dar de baja el equipo. Intentá nuevamente.');
      return;
    }
    onCompletado(`Equipo ${equipo.codigo_inventario} dado de baja`);
  };

  return (
    <ModalFrame
      titulo={tieneHistorial ? 'No se puede eliminar' : 'Eliminar equipo'}
      onCerrar={onCerrar}
      footer={
        tieneHistorial ? (
          <>
            <button type="button" onClick={onCerrar} className="btn-ghost">
              Cancelar
            </button>
            <button type="button" onClick={darDeBaja} disabled={procesando} className="btn-danger">
              {procesando ? 'Procesando…' : 'Dar de baja'}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onCerrar} className="btn-ghost">
              Cancelar
            </button>
            <button type="button" onClick={eliminar} disabled={procesando} className="btn-danger">
              {procesando ? 'Eliminando…' : 'Eliminar'}
            </button>
          </>
        )
      }
    >
      {tieneHistorial ? (
        <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            {MENSAJE_HISTORIAL}.
          </p>
          <p>
            Podés dar de baja el equipo {equipo.codigo_inventario} para que deje de estar disponible, sin perder su
            historial.
          </p>
        </div>
      ) : (
        <p className="text-sm text-gray-700 dark:text-gray-300">
          ¿Seguro que querés eliminar el equipo <span className="font-semibold">{equipo.codigo_inventario}</span>? Esta
          acción no se puede deshacer.
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>
      )}
    </ModalFrame>
  );
}
