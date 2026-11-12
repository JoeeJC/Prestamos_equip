import { useState } from 'react';
import ModalFrame from '@/components/ModalFrame';
import {
  ESTADO_OK,
  SIN_INCIDENCIAS,
  construirEstadoEquipo,
  type Incidencias,
} from '@/lib/estadoEquipos';
import type { DetallePrestamo, Equipo } from '@/lib/supabase';

export type ResultadoEntregaDevolucion = {
  observaciones: string;
  equipos: { id_detalle: string; id_equipo: string; estado: string; conDano: boolean }[];
};

type Props = {
  tipo: 'entregar' | 'recibir';
  detalles: (DetallePrestamo & { equipos?: Equipo })[];
  observacionesIniciales: string;
  guardando: boolean;
  onCancelar: () => void;
  onConfirmar: (resultado: ResultadoEntregaDevolucion) => void;
};

const BOTON_INCIDENCIAS =
  'rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-amber-700 disabled:opacity-50';

export default function EntregaDevolucionModal({
  tipo,
  detalles,
  observacionesIniciales,
  guardando,
  onCancelar,
  onConfirmar,
}: Props) {
  const [todoOk, setTodoOk] = useState(true);
  const [incidencias, setIncidencias] = useState<Record<string, Incidencias>>({});
  const [obs, setObs] = useState(observacionesIniciales);
  const esRecepcion = tipo === 'recibir';

  const incidenciaDe = (id: string) => incidencias[id] ?? SIN_INCIDENCIAS;

  const cambiarTodoOk = (marcado: boolean) => {
    setTodoOk(marcado);
    if (marcado) setIncidencias({});
  };

  const cambiarIncidencia = (id: string, cambio: Partial<Incidencias>) => {
    setIncidencias((prev) => ({ ...prev, [id]: { ...incidenciaDe(id), ...cambio } }));
    setTodoOk(false);
  };

  const confirmar = () => {
    onConfirmar({
      observaciones: todoOk ? '' : obs.trim(),
      equipos: detalles.map((d) => {
        const inc = todoOk ? SIN_INCIDENCIAS : incidenciaDe(d.id_detalle);
        return {
          id_detalle: d.id_detalle,
          id_equipo: d.id_equipo,
          conDano: inc.conDano,
          estado: todoOk ? ESTADO_OK : construirEstadoEquipo(inc),
        };
      }),
    });
  };

  const etiquetaBoton = todoOk
    ? esRecepcion
      ? 'Confirmar devolución OK'
      : 'Confirmar entrega OK'
    : esRecepcion
      ? 'Registrar devolución con incidencias'
      : 'Registrar entrega con incidencias';

  const footer = (
    <>
      <button type="button" onClick={onCancelar} className="btn-ghost">
        Cancelar
      </button>
      <button
        type="button"
        disabled={guardando}
        onClick={confirmar}
        className={todoOk ? 'btn-primary' : BOTON_INCIDENCIAS}
      >
        {guardando ? 'Guardando…' : etiquetaBoton}
      </button>
    </>
  );

  return (
    <ModalFrame
      titulo={esRecepcion ? 'Recibir equipos' : 'Entregar equipos'}
      onCerrar={onCancelar}
      footer={footer}
    >
      <label
        className={`mb-4 flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
          todoOk
            ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30'
            : 'border-gray-200 dark:border-gray-800'
        }`}
      >
        <input
          type="checkbox"
          checked={todoOk}
          onChange={(e) => cambiarTodoOk(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
        />
        <span className="text-sm font-medium text-gray-900 dark:text-white">
          Todo en orden
          <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">
            Equipos y accesorios completos y en buen estado
          </span>
        </span>
      </label>

      <ul className="space-y-3">
        {detalles.map((d) => {
          const inc = incidenciaDe(d.id_detalle);
          const esNotebook = d.equipos?.categorias_equipo?.nombre === 'Notebook';
          const mostrarNotas = !todoOk && (inc.conDano || inc.sinCargador);
          return (
            <li
              key={d.id_detalle}
              className={`rounded-lg border p-3 transition-colors ${
                !todoOk && (inc.conDano || inc.sinCargador)
                  ? 'border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20'
                  : 'border-gray-200 dark:border-gray-800'
              }`}
            >
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {d.equipos?.codigo_inventario} · {d.equipos?.categorias_equipo?.nombre}
                  </p>
                  <p className="text-xs text-gray-500">{d.equipos?.marca_modelo ?? '—'}</p>
                </div>
                {inc.sinCargador && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                    Sin cargador
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={inc.conDano}
                    onChange={(e) => cambiarIncidencia(d.id_detalle, { conDano: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  Con daño
                </label>
                {esRecepcion && esNotebook && (
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={inc.sinCargador}
                      onChange={(e) =>
                        cambiarIncidencia(d.id_detalle, { sinCargador: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                    />
                    Falta cargador
                  </label>
                )}
              </div>

              {esRecepcion && inc.conDano && (
                <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                  Pasará a «En mantenimiento»
                </p>
              )}

              {mostrarNotas && (
                <input
                  className="input mt-2"
                  placeholder="Detalle opcional: rotura de pantalla, cable cortado, etc."
                  value={inc.notas}
                  onChange={(e) => cambiarIncidencia(d.id_detalle, { notas: e.target.value })}
                />
              )}
            </li>
          );
        })}
      </ul>

      {!todoOk && (
        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-gray-500">
            Observaciones generales (opcional)
          </label>
          <textarea
            className="input min-h-20"
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            placeholder="Notas del administrador…"
          />
        </div>
      )}
    </ModalFrame>
  );
}
