import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Download, FileSpreadsheet, Info, Upload, } from 'lucide-react';
import type * as XLSX from 'xlsx';
import Badge from '@/components/ui/Badge';
import ModalFrame from '@/components/ui/ModalFrame';
import {
  descargarPlantillaEquiposExcel, leerLibroExcelEquipos, parsearHojaEquipos, FilaExcelEquipo, } from '@/features/inventario/utils/excelEquipos';
import { ESTADOS_EDITABLES, mensajeErrorEquipoDuplicado, EstadoEditable } from '@/features/inventario/utils/inventario';
import { supabase } from '@/services/supabaseClient';
import type { Categoria, Equipo } from '@/types/database';

type FiltroPreview = 'todas' | 'crear' | 'actualizar' | 'error';

type ResultadoEjecucion = {
  creados: number;
  actualizados: number;
  fallidos: { filaNumero: number; codigo: string; error: string }[];
  omitidosValidacion: number;
};

type AjusteFila = {
  estado?: EstadoEditable;
  oculto_catalogo?: boolean;
};

export default function ImportarExcelEquiposModal({
  equiposExistentes,
  categorias,
  onCerrar,
  onImportado,
}: {
  equiposExistentes: Equipo[];
  categorias: Categoria[];
  onCerrar: () => void;
  onImportado: (mensaje: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const categoriaNotebook = useMemo(
    () =>
      categorias.find((c) => c.nombre.toLowerCase().includes('notebook'))?.id_categoria ??
      categorias[0]?.id_categoria ??
      '',
    [categorias],
  );

  const [archivoNombre, setArchivoNombre] = useState<string | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [hojaSeleccionada, setHojaSeleccionada] = useState<string>('');
  const [categoriaPorDefectoId, setCategoriaPorDefectoId] = useState<string>(categoriaNotebook);
  const [marcaPorDefecto, setMarcaPorDefecto] = useState<string>('Notebook CX');
  const [inferirPorObs, setInferirPorObs] = useState<boolean>(true);
  const [ajustes, setAjustes] = useState<Record<number, AjusteFila>>({});
  const [filtroPreview, setFiltroPreview] = useState<FiltroPreview>('todas');
  const [errorLectura, setErrorLectura] = useState<string | null>(null);

  const [importando, setImportando] = useState(false);
  const [progreso, setProgreso] = useState<{ actual: number; total: number }>({ actual: 0, total: 0 });
  const [resultado, setResultado] = useState<ResultadoEjecucion | null>(null);

  const categoriaEfectiva = categoriaPorDefectoId || categoriaNotebook;

  useEffect(() => {
    if (!categoriaPorDefectoId && categoriaNotebook) {
      setCategoriaPorDefectoId(categoriaNotebook);
    }
  }, [categoriaNotebook, categoriaPorDefectoId]);

  const parseo = useMemo(() => {
    if (!workbook || !hojaSeleccionada) return null;
    return parsearHojaEquipos(
      workbook,
      hojaSeleccionada,
      equiposExistentes,
      categorias,
      categoriaEfectiva,
      marcaPorDefecto,
      inferirPorObs,
    );
  }, [
    workbook,
    hojaSeleccionada,
    equiposExistentes,
    categorias,
    categoriaEfectiva,
    marcaPorDefecto,
    inferirPorObs,
  ]);

  const filasConAjustes = useMemo<FilaExcelEquipo[]>(() => {
    return (parseo?.filas ?? []).map((f) => {
      const ov = ajustes[f.filaNumero];
      if (!ov) return f;
      return {
        ...f,
        estado: ov.estado ?? f.estado,
        oculto_catalogo: ov.oculto_catalogo ?? f.oculto_catalogo,
      };
    });
  }, [parseo, ajustes]);

  const conteos = useMemo(() => {
    return {
      total: filasConAjustes.length,
      crear: filasConAjustes.filter((f) => f.accion === 'crear').length,
      actualizar: filasConAjustes.filter((f) => f.accion === 'actualizar').length,
      error: filasConAjustes.filter((f) => f.accion === 'error').length,
    };
  }, [filasConAjustes]);

  const filasVisibles = useMemo(() => {
    if (filtroPreview === 'todas') return filasConAjustes;
    return filasConAjustes.filter((f) => f.accion === filtroPreview);
  }, [filasConAjustes, filtroPreview]);

  const procesarArchivo = async (file: File) => {
    setErrorLectura(null);
    setResultado(null);
    setAjustes({});
    setFiltroPreview('todas');
    try {
      const buffer = await file.arrayBuffer();
      const wb = leerLibroExcelEquipos(buffer);
      if (!wb.SheetNames || wb.SheetNames.length === 0) {
        setErrorLectura('El archivo no contiene ninguna hoja legible.');
        setWorkbook(null);
        return;
      }
      setArchivoNombre(file.name);
      setWorkbook(wb);
      setHojaSeleccionada(wb.SheetNames[0]);
    } catch {
      setErrorLectura('No se pudo leer el archivo. Asegurate de que sea un Excel (.xlsx / .xls) válido.');
      setWorkbook(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void procesarArchivo(file);
    e.target.value = '';
  };

  const actualizarAjuste = (filaNumero: number, cambio: AjusteFila) => {
    setAjustes((prev) => ({
      ...prev,
      [filaNumero]: { ...prev[filaNumero], ...cambio },
    }));
  };

  const ejecutarImportacion = async () => {
    if (!parseo) return;
    const procesables = filasConAjustes.filter((f) => f.accion === 'crear' || f.accion === 'actualizar');
    if (procesables.length === 0) return;

    setImportando(true);
    setProgreso({ actual: 0, total: procesables.length });

    let creados = 0;
    let actualizados = 0;
    const fallidos: ResultadoEjecucion['fallidos'] = [];

    for (let i = 0; i < procesables.length; i++) {
      const fila = procesables[i];
      try {
        if (fila.accion === 'crear') {
          const { error } = await supabase.from('equipos').insert({
            id_categoria: fila.id_categoria,
            codigo_inventario: fila.codigo_inventario,
            numero_serie: fila.numero_serie || null,
            marca_modelo: fila.marca_modelo || null,
            estado: fila.estado,
            oculto_catalogo: fila.oculto_catalogo,
            observaciones: fila.observaciones || null,
          });
          if (error) {
            throw new Error(mensajeErrorEquipoDuplicado(error) ?? error.message);
          }
          creados++;
        } else if (fila.accion === 'actualizar' && fila.idEquipoExistente) {
          const bloqueadoActual =
            fila.estadoExistente === 'Reservado' || fila.estadoExistente === 'En préstamo';
          const { error } = await supabase
            .from('equipos')
            .update({
              id_categoria: fila.id_categoria,
              numero_serie: fila.numero_serie || null,
              marca_modelo: fila.marca_modelo || null,
              ...(bloqueadoActual ? {} : { estado: fila.estado }),
              oculto_catalogo: fila.oculto_catalogo,
              observaciones: fila.observaciones || null,
            })
            .eq('id_equipo', fila.idEquipoExistente);
          if (error) {
            throw new Error(mensajeErrorEquipoDuplicado(error) ?? error.message);
          }
          actualizados++;
        }
      } catch (err) {
        fallidos.push({
          filaNumero: fila.filaNumero,
          codigo: fila.codigo_inventario,
          error: err instanceof Error ? err.message : 'Error al guardar equipo',
        });
      }
      setProgreso({ actual: i + 1, total: procesables.length });
    }

    setResultado({
      creados,
      actualizados,
      fallidos,
      omitidosValidacion: conteos.error,
    });
    setImportando(false);

    if (creados > 0 || actualizados > 0) {
      const partes = [];
      if (creados > 0) partes.push(`${creados} creado${creados === 1 ? '' : 's'}`);
      if (actualizados > 0) partes.push(`${actualizados} actualizado${actualizados === 1 ? '' : 's'}`);
      if (fallidos.length + conteos.error > 0) {
        partes.push(`${fallidos.length + conteos.error} con error`);
      }
      onImportado(`Importación de equipos finalizada: ${partes.join(' · ')}.`);
    }
  };

  const accionBadge = (fila: FilaExcelEquipo) => {
    if (fila.accion === 'crear') return <Badge variant="green">Crear</Badge>;
    if (fila.accion === 'actualizar') return <Badge variant="blue">Actualizar</Badge>;
    return <Badge variant="red">Error</Badge>;
  };

  const procesablesCount = conteos.crear + conteos.actualizar;

  return (
    <ModalFrame
      titulo="Importar equipos desde Excel (.xlsx)"
      onCerrar={() => {
        if (!importando) onCerrar();
      }}
      maxWidth="max-w-5xl"
      footer={
        <>
          <button type="button" onClick={onCerrar} disabled={importando} className="btn-secondary">
            {resultado ? 'Cerrar' : 'Cancelar'}
          </button>
          {!resultado && (
            <button
              type="button"
              onClick={() => void ejecutarImportacion()}
              disabled={importando || !parseo || parseo.columnasFaltantes.length > 0 || procesablesCount === 0}
              className="btn-primary"
            >
              {importando
                ? `Importando ${progreso.actual}/${progreso.total}…`
                : `Importar ${procesablesCount} ${procesablesCount === 1 ? 'equipo' : 'equipos'}`}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-brand-200 bg-brand-50/70 p-3.5 text-xs text-brand-900 dark:border-brand-900/50 dark:bg-brand-950/30 dark:text-brand-100">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 font-semibold">
                <Info size={14} className="shrink-0 text-brand-600 dark:text-brand-300" />
                Reglas de importación automática
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-brand-800 dark:text-brand-200">
                <li>
                  Columna obligatoria: <strong>Nº Inventario</strong> (o <em>Código</em>). Opcionales:{' '}
                  <strong>Nº Serie</strong>, <strong>Observaciones</strong>, <strong>Marca / Modelo</strong>,{' '}
                  <strong>Categoría</strong>, <strong>Estado</strong> y <strong>Oculto en catálogo</strong>.
                </li>
                <li>
                  Columnas auxiliares como <em>Orden</em> se <strong>ignoran automáticamente</strong>. Podés ajustar
                  el estado y si va oculto en catálogo directamente en la vista previa antes de importar.
                </li>
                <li>
                  Si el Nº de Inventario ya existe, actualiza sus datos sin perder su historial de préstamos.
                </li>
              </ul>
            </div>
            <button
              type="button"
              onClick={descargarPlantillaEquiposExcel}
              className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
            >
              <Download size={14} /> Descargar plantilla .xlsx
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Archivo Excel (.xlsx, .xls)
            </label>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              disabled={importando}
              onClick={() => inputRef.current?.click()}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3.5 py-2 text-left text-sm transition hover:border-brand-400 hover:bg-brand-50/40 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-brand-600"
            >
              <span className="flex min-w-0 items-center gap-2 text-gray-700 dark:text-gray-200">
                <FileSpreadsheet size={18} className="shrink-0 text-emerald-600" />
                <span className="truncate">{archivoNombre ?? 'Elegir archivo Excel (.xlsx)…'}</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm dark:bg-gray-800 dark:text-gray-200">
                <Upload size={13} /> Examinar
              </span>
            </button>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Categoría por defecto
            </label>
            <select
              className="input h-10 py-1 text-sm"
              value={categoriaEfectiva}
              onChange={(e) => setCategoriaPorDefectoId(e.target.value)}
              disabled={importando}
            >
              {categorias.map((c) => (
                <option key={c.id_categoria} value={c.id_categoria}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Marca / Modelo por defecto
            </label>
            <input
              className="input h-10 py-1 text-sm"
              placeholder="Ej: Notebook CX"
              value={marcaPorDefecto}
              onChange={(e) => setMarcaPorDefecto(e.target.value)}
              disabled={importando}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={inferirPorObs}
              onChange={(e) => {
                setInferirPorObs(e.target.checked);
                setAjustes({});
              }}
              disabled={importando}
              className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            Sugerir automáticamente «En mantenimiento» y «Oculto en catálogo» según Observaciones (si el Excel no tiene esas columnas)
          </label>

          {workbook && workbook.SheetNames.length > 1 && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Hoja:</label>
              <select
                className="input h-8 w-auto py-1 text-xs"
                value={hojaSeleccionada}
                onChange={(e) => {
                  setHojaSeleccionada(e.target.value);
                  setAjustes({});
                  setResultado(null);
                }}
                disabled={importando}
              >
                {workbook.SheetNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {errorLectura && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{errorLectura}</span>
          </div>
        )}

        {importando && (
          <div className="space-y-1.5 rounded-xl border border-gray-200 p-3 dark:border-gray-800">
            <div className="flex justify-between text-xs font-medium text-gray-700 dark:text-gray-200">
              <span>Guardando equipos en el inventario…</span>
              <span>
                {progreso.actual} / {progreso.total}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div
                className="h-full bg-brand-600 transition-all"
                style={{
                  width: `${progreso.total > 0 ? Math.round((progreso.actual / progreso.total) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        )}

        {resultado && (
          <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/30">
            <p className="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-200">
              <CheckCircle2 size={18} />
              Importación completada
            </p>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="green">Creados: {resultado.creados}</Badge>
              <Badge variant="blue">Actualizados: {resultado.actualizados}</Badge>
              {resultado.omitidosValidacion > 0 && (
                <Badge variant="yellow">Omitidos por validación: {resultado.omitidosValidacion}</Badge>
              )}
              {resultado.fallidos.length > 0 && (
                <Badge variant="red">Fallidos al guardar: {resultado.fallidos.length}</Badge>
              )}
            </div>
            {resultado.fallidos.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-red-200 bg-white p-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-gray-950 dark:text-red-300">
                <p className="mb-1 font-semibold">Filas con error al guardar:</p>
                <ul className="space-y-1">
                  {resultado.fallidos.map((f) => (
                    <li key={`${f.filaNumero}-${f.codigo}`}>
                      Fila {f.filaNumero} (Código {f.codigo}): {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {parseo && !resultado && (
          <div className="space-y-3">
            {parseo.columnasFaltantes.length > 0 ? (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">No encontramos la columna de Nº de Inventario / Código:</p>
                  <p className="text-xs">
                    Verificá que la hoja tenga una columna llamada <strong>Nº Inventario</strong> o{' '}
                    <strong>Código</strong>, o descargá la plantilla .xlsx.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs dark:border-gray-800 dark:bg-gray-900/50">
                  <span className="font-medium text-gray-700 dark:text-gray-200">
                    Columnas usadas:{' '}
                    <span className="font-normal text-gray-600 dark:text-gray-300">
                      {parseo.columnasDetectadas.map((c) => c.encabezadoOriginal).join(', ')}
                    </span>
                  </span>
                  {parseo.columnasIgnoradas.length > 0 && (
                    <span className="text-gray-500 dark:text-gray-400">
                      · Columnas ignoradas:{' '}
                      <span className="italic">{parseo.columnasIgnoradas.join(', ')}</span>
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setFiltroPreview('todas')}
                      className={`rounded-lg px-2.5 py-1 font-medium transition ${
                        filtroPreview === 'todas'
                          ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
                      }`}
                    >
                      Todas ({conteos.total})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFiltroPreview('crear')}
                      className={`rounded-lg px-2.5 py-1 font-medium transition ${
                        filtroPreview === 'crear'
                          ? 'bg-green-600 text-white'
                          : 'bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-950/40 dark:text-green-300'
                      }`}
                    >
                      Nuevos ({conteos.crear})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFiltroPreview('actualizar')}
                      className={`rounded-lg px-2.5 py-1 font-medium transition ${
                        filtroPreview === 'actualizar'
                          ? 'bg-blue-600 text-white'
                          : 'bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300'
                      }`}
                    >
                      Actualizar ({conteos.actualizar})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFiltroPreview('error')}
                      className={`rounded-lg px-2.5 py-1 font-medium transition ${
                        filtroPreview === 'error'
                          ? 'bg-red-600 text-white'
                          : 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300'
                      }`}
                    >
                      Con errores ({conteos.error})
                    </button>
                  </div>
                </div>

                {filasVisibles.length === 0 ? (
                  <div className="rounded-xl border border-gray-200 py-8 text-center text-sm text-gray-500 dark:border-gray-800">
                    No hay filas en esta categoría.
                  </div>
                ) : (
                  <div className="max-h-72 overflow-auto rounded-xl border border-gray-200 dark:border-gray-800">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 border-b border-gray-200 bg-gray-50 text-[11px] uppercase text-gray-500 dark:border-gray-800 dark:bg-gray-900">
                        <tr>
                          <th className="px-2.5 py-2">#</th>
                          <th className="px-2.5 py-2">Acción</th>
                          <th className="px-2.5 py-2">Nº Inv.</th>
                          <th className="px-2.5 py-2">Nº Serie</th>
                          <th className="px-2.5 py-2">Categoría / Marca</th>
                          <th className="px-2.5 py-2">Estado</th>
                          <th className="px-2.5 py-2 text-center">Oculto</th>
                          <th className="px-2.5 py-2">Observaciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {filasVisibles.map((f) => {
                          const bloqueado =
                            f.estadoExistente === 'Reservado' || f.estadoExistente === 'En préstamo';
                          return (
                            <tr
                              key={`${f.filaNumero}-${f.codigo_inventario}`}
                              className={
                                f.accion === 'error'
                                  ? 'bg-red-50/40 dark:bg-red-950/20'
                                  : 'hover:bg-gray-50/70 dark:hover:bg-gray-900/40'
                              }
                            >
                              <td className="px-2.5 py-1.5 text-gray-400">{f.filaNumero}</td>
                              <td className="px-2.5 py-1.5">{accionBadge(f)}</td>
                              <td className="px-2.5 py-1.5 font-semibold text-gray-900 dark:text-white">
                                {f.codigo_inventario || '—'}
                              </td>
                              <td className="px-2.5 py-1.5 font-mono text-[11px] text-gray-600 dark:text-gray-300">
                                {f.numero_serie || <span className="italic text-gray-400">Sin serie</span>}
                              </td>
                              <td className="px-2.5 py-1.5 text-gray-700 dark:text-gray-300">
                                {f.categoriaNombre}
                                {f.marca_modelo ? ` · ${f.marca_modelo}` : ''}
                              </td>
                              <td className="px-2.5 py-1.5">
                                {f.accion === 'error' ? (
                                  <span className="text-red-600 dark:text-red-400">{f.errores.join(' · ')}</span>
                                ) : bloqueado ? (
                                  <Badge variant="blue">{f.estadoExistente}</Badge>
                                ) : (
                                  <select
                                    className="input h-7 py-0.5 text-xs"
                                    value={f.estado}
                                    disabled={importando}
                                    onChange={(e) =>
                                      actualizarAjuste(f.filaNumero, {
                                        estado: e.target.value as EstadoEditable,
                                      })
                                    }
                                  >
                                    {ESTADOS_EDITABLES.map((est) => (
                                      <option key={est} value={est}>
                                        {est}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </td>
                              <td className="px-2.5 py-1.5 text-center">
                                {f.accion !== 'error' && (
                                  <input
                                    type="checkbox"
                                    checked={f.oculto_catalogo}
                                    disabled={importando}
                                    onChange={(e) =>
                                      actualizarAjuste(f.filaNumero, {
                                        oculto_catalogo: e.target.checked,
                                      })
                                    }
                                    className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                                    title="Ocultar en catálogo para estudiantes y usuarios"
                                  />
                                )}
                              </td>
                              <td className="px-2.5 py-1.5 text-gray-600 dark:text-gray-300">
                                {f.observaciones || '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </ModalFrame>
  );
}
