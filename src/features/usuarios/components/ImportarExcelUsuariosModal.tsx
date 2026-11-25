import { useMemo, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Download, FileSpreadsheet, Info, Upload, } from 'lucide-react';
import type * as XLSX from 'xlsx';
import Badge from '@/components/ui/Badge';
import ModalFrame from '@/components/ui/ModalFrame';
import { useAuth } from '@/context/AuthContext';
import {
  descargarPlantillaPadronExcel, leerLibroExcel, parsearHojaUsuarios, FilaExcelUsuario, } from '@/features/usuarios/utils/excelUsuarios';
import type { Rol } from '@/types/database';
import {
  actualizarUsuarioAdmin,
  crearUsuarioAdmin,
  type UsuarioAdmin,
} from '@/features/usuarios/services/usuariosService';

type FiltroPreview = 'todas' | 'crear' | 'actualizar' | 'error';

type ResultadoEjecucion = {
  creados: number;
  actualizados: number;
  fallidos: { filaNumero: number; dni: string; nombre: string; error: string }[];
  omitidosValidacion: number;
};

export default function ImportarExcelUsuariosModal({
  usuariosExistentes,
  rolesDisponibles,
  onCerrar,
  onImportado,
}: {
  usuariosExistentes: UsuarioAdmin[];
  rolesDisponibles: Rol[];
  onCerrar: () => void;
  onImportado: (mensaje: string) => void;
}) {
  const { session } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const rolEstudiante = useMemo(
    () => rolesDisponibles.find((r) => r.nombre === 'Estudiante')?.id_rol ?? rolesDisponibles[0]?.id_rol ?? '',
    [rolesDisponibles],
  );

  const [archivoNombre, setArchivoNombre] = useState<string | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [hojaSeleccionada, setHojaSeleccionada] = useState<string>('');
  const [rolPorDefectoId, setRolPorDefectoId] = useState<string>(rolEstudiante);
  const [filtroPreview, setFiltroPreview] = useState<FiltroPreview>('todas');
  const [errorLectura, setErrorLectura] = useState<string | null>(null);

  const [importando, setImportando] = useState(false);
  const [progreso, setProgreso] = useState<{ actual: number; total: number }>({ actual: 0, total: 0 });
  const [resultado, setResultado] = useState<ResultadoEjecucion | null>(null);

  const rolPorDefectoEfectivo = rolPorDefectoId || rolEstudiante;

  const parseo = useMemo(() => {
    if (!workbook || !hojaSeleccionada) return null;
    return parsearHojaUsuarios(
      workbook,
      hojaSeleccionada,
      usuariosExistentes,
      rolesDisponibles,
      rolPorDefectoEfectivo,
    );
  }, [workbook, hojaSeleccionada, usuariosExistentes, rolesDisponibles, rolPorDefectoEfectivo]);

  const conteos = useMemo(() => {
    const filas = parseo?.filas ?? [];
    return {
      total: filas.length,
      crear: filas.filter((f) => f.accion === 'crear').length,
      actualizar: filas.filter((f) => f.accion === 'actualizar').length,
      error: filas.filter((f) => f.accion === 'error').length,
    };
  }, [parseo]);

  const filasVisibles = useMemo(() => {
    const filas = parseo?.filas ?? [];
    if (filtroPreview === 'todas') return filas;
    return filas.filter((f) => f.accion === filtroPreview);
  }, [parseo, filtroPreview]);

  const procesarArchivo = async (file: File) => {
    setErrorLectura(null);
    setResultado(null);
    setFiltroPreview('todas');
    try {
      const buffer = await file.arrayBuffer();
      const wb = leerLibroExcel(buffer);
      if (!wb.SheetNames || wb.SheetNames.length === 0) {
        setErrorLectura('El archivo no contiene ninguna hoja legible.');
        setWorkbook(null);
        return;
      }
      setArchivoNombre(file.name);
      setWorkbook(wb);
      setHojaSeleccionada(wb.SheetNames[0]);
    } catch {
      setErrorLectura('No se pudo leer el archivo. Asegurate de que sea un Excel (.xlsx / .xls) o CSV válido.');
      setWorkbook(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void procesarArchivo(file);
    e.target.value = '';
  };

  const ejecutarImportacion = async () => {
    if (!session || !parseo) return;
    const procesables = parseo.filas.filter((f) => f.accion === 'crear' || f.accion === 'actualizar');
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
          await crearUsuarioAdmin(session.token, {
            dni: fila.dni,
            nombre: fila.nombre,
            apellido: fila.apellido,
            email: fila.email,
            telefono: fila.telefono,
            curso: fila.curso,
            password: fila.dni,
            estado: 'Activo',
            roles: fila.rolesIds,
          });
          creados++;
        } else if (fila.accion === 'actualizar' && fila.idUsuarioExistente) {
          await actualizarUsuarioAdmin(session.token, fila.idUsuarioExistente, {
            dni: fila.dni,
            nombre: fila.nombre,
            apellido: fila.apellido,
            email: fila.email,
            telefono: fila.telefono,
            curso: fila.curso,
            estado: fila.estadoExistente ?? 'Activo',
            roles: fila.rolesIds,
          });
          actualizados++;
        }
      } catch (err) {
        fallidos.push({
          filaNumero: fila.filaNumero,
          dni: fila.dni,
          nombre: `${fila.apellido}, ${fila.nombre}`,
          error: err instanceof Error ? err.message : 'Error al guardar usuario',
        });
      }
      setProgreso({ actual: i + 1, total: procesables.length });
    }

    const resFinal: ResultadoEjecucion = {
      creados,
      actualizados,
      fallidos,
      omitidosValidacion: conteos.error,
    };
    setResultado(resFinal);
    setImportando(false);

    if (creados > 0 || actualizados > 0) {
      const partes = [];
      if (creados > 0) partes.push(`${creados} creado${creados === 1 ? '' : 's'}`);
      if (actualizados > 0) partes.push(`${actualizados} actualizado${actualizados === 1 ? '' : 's'}`);
      if (fallidos.length + conteos.error > 0) {
        partes.push(`${fallidos.length + conteos.error} con error/omitido`);
      }
      onImportado(`Importación Excel finalizada: ${partes.join(' · ')}.`);
    }
  };

  const accionBadge = (fila: FilaExcelUsuario) => {
    if (fila.accion === 'crear') return <Badge variant="green">Crear</Badge>;
    if (fila.accion === 'actualizar') return <Badge variant="blue">Actualizar</Badge>;
    return <Badge variant="red">Error</Badge>;
  };

  const procesablesCount = conteos.crear + conteos.actualizar;

  return (
    <ModalFrame
      titulo="Importar padrón desde Excel (.xlsx)"
      onCerrar={() => {
        if (!importando) onCerrar();
      }}
      maxWidth="max-w-4xl"
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
                : `Importar ${procesablesCount} ${procesablesCount === 1 ? 'usuario' : 'usuarios'}`}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {/* Reglas e instrucciones */}
        <div className="rounded-xl border border-brand-200 bg-brand-50/70 p-3.5 text-xs text-brand-900 dark:border-brand-900/50 dark:bg-brand-950/30 dark:text-brand-100">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 font-semibold">
                <Info size={14} className="shrink-0 text-brand-600 dark:text-brand-300" />
                Reglas de importación automática
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-brand-800 dark:text-brand-200">
                <li>
                  Columnas obligatorias: <strong>dni</strong>, <strong>nombre</strong>, <strong>apellido</strong>,{' '}
                  <strong>email</strong>. Opcionales: <strong>telefono</strong>, <strong>curso</strong> (
                  <span className="font-medium">1°, 2°, 3°, Egresado</span>) y <strong>rol</strong>.
                </li>
                <li>
                  Cualquier otra columna del Excel (ej. <em>carrera, comisión, legajo</em>) se{' '}
                  <strong>ignora automáticamente</strong>.
                </li>
                <li>
                  Usuarios nuevos: se crean con <strong>usuario = DNI</strong> y <strong>contraseña = DNI</strong>.
                  Si el DNI ya existe, se actualizan sus datos, curso y rol.
                </li>
              </ul>
            </div>
            <button
              type="button"
              onClick={descargarPlantillaPadronExcel}
              className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
            >
              <Download size={14} /> Descargar plantilla .xlsx
            </button>
          </div>
        </div>

        {/* Selector de archivo y opciones */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Archivo Excel (.xlsx, .xls o .csv)
            </label>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              disabled={importando}
              onClick={() => inputRef.current?.click()}
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3.5 py-2.5 text-left text-sm transition hover:border-brand-400 hover:bg-brand-50/40 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-brand-600"
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
              Rol por defecto (si falta)
            </label>
            <select
              className="input"
              value={rolPorDefectoEfectivo}
              onChange={(e) => setRolPorDefectoId(e.target.value)}
              disabled={importando}
            >
              {rolesDisponibles.map((r) => (
                <option key={r.id_rol} value={r.id_rol}>
                  {r.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>

        {workbook && workbook.SheetNames.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Hoja del Excel:</label>
            <select
              className="input h-9 w-auto py-1 text-sm"
              value={hojaSeleccionada}
              onChange={(e) => {
                setHojaSeleccionada(e.target.value);
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

        {errorLectura && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{errorLectura}</span>
          </div>
        )}

        {/* Progreso durante la importación */}
        {importando && (
          <div className="space-y-1.5 rounded-xl border border-gray-200 p-3 dark:border-gray-800">
            <div className="flex justify-between text-xs font-medium text-gray-700 dark:text-gray-200">
              <span>Procesando padrón en la base de datos…</span>
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

        {/* Resultado final */}
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
                    <li key={`${f.filaNumero}-${f.dni}`}>
                      Fila {f.filaNumero} ({f.nombre} · DNI {f.dni}): {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Vista previa del archivo parseado */}
        {parseo && !resultado && (
          <div className="space-y-3">
            {parseo.columnasFaltantes.length > 0 ? (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Faltan columnas obligatorias en esta hoja:</p>
                  <p className="text-xs">
                    No encontramos: <strong>{parseo.columnasFaltantes.join(', ')}</strong>. Verificá los encabezados o
                    descargá la plantilla .xlsx.
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

                {/* Resumen y filtros de vista previa */}
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
                          <th className="px-3 py-2">#</th>
                          <th className="px-3 py-2">Acción</th>
                          <th className="px-3 py-2">DNI</th>
                          <th className="px-3 py-2">Apellido y Nombre</th>
                          <th className="px-3 py-2">Email</th>
                          <th className="px-3 py-2">Curso</th>
                          <th className="px-3 py-2">Rol</th>
                          <th className="px-3 py-2">Detalle</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {filasVisibles.map((f) => (
                          <tr
                            key={`${f.filaNumero}-${f.dni}`}
                            className={
                              f.accion === 'error'
                                ? 'bg-red-50/40 dark:bg-red-950/20'
                                : 'hover:bg-gray-50/70 dark:hover:bg-gray-900/40'
                            }
                          >
                            <td className="px-3 py-2 text-gray-400">{f.filaNumero}</td>
                            <td className="px-3 py-2">{accionBadge(f)}</td>
                            <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">
                              {f.dni || '—'}
                            </td>
                            <td className="px-3 py-2 text-gray-800 dark:text-gray-200">
                              {f.apellido || f.nombre ? `${f.apellido}, ${f.nombre}` : '—'}
                            </td>
                            <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{f.email || '—'}</td>
                            <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                              {f.curso || <span className="italic text-gray-400">Sin curso</span>}
                            </td>
                            <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                              {f.rolesNombres.join(', ') || '—'}
                            </td>
                            <td className="px-3 py-2">
                              {f.errores.length > 0 ? (
                                <span className="text-red-600 dark:text-red-400">{f.errores.join(' · ')}</span>
                              ) : f.accion === 'crear' ? (
                                <span className="text-gray-500">Clave inicial: DNI</span>
                              ) : (
                                <span className="text-gray-500">Actualiza padrón existente</span>
                              )}
                            </td>
                          </tr>
                        ))}
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
