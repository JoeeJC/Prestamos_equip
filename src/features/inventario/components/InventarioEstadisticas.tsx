import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BarChart3, CalendarRange, CheckCircle2, Clock, Download, RotateCcw, SlidersHorizontal, TrendingUp, UserX, } from 'lucide-react';
import Badge, { estadoEquipoVariant } from '@/components/ui/Badge';
import {
  CUATRIMESTRES_DEFAULT, MESES_CORTOS, MESES_NOMBRES, calcularEstadisticasPeriodo, calcularRangoPeriodo, cargarConfigCuatrimestres, esCategoriaNotebook, exportarEstadisticasExcel, formatearFechaCorta, guardarConfigCuatrimestres, CuatrimestresConfig, PrestamoReporte, PresetPeriodo, } from '@/features/inventario/services/estadisticas';
import { cargarConfiguracionHorarios } from '@/features/configuracion/services/horariosService';
import { fechaLocalISO } from '@/utils/fechas';
import { supabase } from '@/services/supabaseClient';
import type { Categoria, Equipo } from '@/types/database';

type SubVistaEquipos = 'menos_usados' | 'mas_usados' | 'sin_uso' | 'observaciones';

export default function InventarioEstadisticas({
  categorias,
  equipos,
}: {
  categorias: Categoria[];
  equipos: Equipo[];
}) {
  const anioActual = new Date().getFullYear();
  const [cuatrimestresCfg, setCuatrimestresCfg] = useState<CuatrimestresConfig>(() =>
    cargarConfigCuatrimestres(),
  );
  const [editandoCuatrimestres, setEditandoCuatrimestres] = useState(false);

  const [preset, setPreset] = useState<PresetPeriodo>('ultimos30');
  const [anioSeleccionado, setAnioSeleccionado] = useState<number>(anioActual);
  const [{ desde, hasta }, setRango] = useState<{ desde: string; hasta: string }>(() =>
    calcularRangoPeriodo('ultimos30', anioActual, cargarConfigCuatrimestres()),
  );
  const [categoriaId, setCategoriaId] = useState<string>('');
  const [subVistaEquipos, setSubVistaEquipos] = useState<SubVistaEquipos>('menos_usados');
  const [soloNotebooks, setSoloNotebooks] = useState(true);
  const [soloDisponibles, setSoloDisponibles] = useState(false);

  const [prestamos, setPrestamos] = useState<PrestamoReporte[] | null>(null);
  const [reservasProximas, setReservasProximas] = useState<Map<string, number>>(() => new Map());
  const [toleranciaMin, setToleranciaMin] = useState<number>(5);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const aplicarPreset = (nuevoPreset: PresetPeriodo, nuevoAnio = anioSeleccionado, cfg = cuatrimestresCfg) => {
    setPreset(nuevoPreset);
    setAnioSeleccionado(nuevoAnio);
    if (nuevoPreset !== 'personalizado') {
      setRango(calcularRangoPeriodo(nuevoPreset, nuevoAnio, cfg));
    }
  };

  const actualizarCuatrimestreCfg = (parcial: Partial<CuatrimestresConfig>) => {
    const siguiente: CuatrimestresConfig = { ...cuatrimestresCfg, ...parcial };
    if (siguiente.c1Fin < siguiente.c1Inicio) siguiente.c1Fin = siguiente.c1Inicio;
    if (siguiente.c2Fin < siguiente.c2Inicio) siguiente.c2Fin = siguiente.c2Inicio;
    setCuatrimestresCfg(siguiente);
    guardarConfigCuatrimestres(siguiente);
    if (preset === 'c1' || preset === 'c2') {
      setRango(calcularRangoPeriodo(preset, anioSeleccionado, siguiente));
    }
  };

  const restablecerCuatrimestres = () => {
    setCuatrimestresCfg(CUATRIMESTRES_DEFAULT);
    guardarConfigCuatrimestres(CUATRIMESTRES_DEFAULT);
    if (preset === 'c1' || preset === 'c2') {
      setRango(calcularRangoPeriodo(preset, anioSeleccionado, CUATRIMESTRES_DEFAULT));
    }
  };

  const cargarDatosPeriodo = useCallback(async () => {
    if (!desde || !hasta) return;
    setCargando(true);
    setError(null);
    const fechaIni = desde <= hasta ? desde : hasta;
    const fechaFin = desde <= hasta ? hasta : desde;
    const hoy = fechaLocalISO();

    const [cfgHorarios, resPrestamos, resProximas] = await Promise.all([
      cargarConfiguracionHorarios().catch(() => null),
      supabase
        .from('prestamos')
        .select(
          '*, usuarios(id_usuario, dni, nombre, apellido, curso, usuario_roles(roles(id_rol, nombre))), detalle_prestamos(id_detalle, id_equipo, estado_salida, estado_devolucion, equipos(id_equipo, id_categoria, codigo_inventario, marca_modelo, estado))',
        )
        .gte('fecha_prestamo', fechaIni)
        .lte('fecha_prestamo', fechaFin)
        .order('fecha_prestamo', { ascending: false }),
      supabase
        .from('prestamos')
        .select('id_prestamo, detalle_prestamos(id_equipo)')
        .eq('estado', 'Reservado')
        .gte('fecha_prestamo', hoy),
    ]);

    setCargando(false);
    if (cfgHorarios && typeof cfgHorarios.tolerancia_retiro_min === 'number') {
      setToleranciaMin(cfgHorarios.tolerancia_retiro_min);
    }
    if (resPrestamos.error) {
      setError('No se pudieron cargar las estadísticas del período seleccionado.');
      return;
    }

    const proxMap = new Map<string, number>();
    for (const r of (resProximas.data ?? []) as { detalle_prestamos?: { id_equipo: string }[] }[]) {
      for (const d of r.detalle_prestamos ?? []) {
        if (!d.id_equipo) continue;
        proxMap.set(d.id_equipo, (proxMap.get(d.id_equipo) ?? 0) + 1);
      }
    }

    setReservasProximas(proxMap);
    setPrestamos((resPrestamos.data ?? []) as PrestamoReporte[]);
  }, [desde, hasta]);

  useEffect(() => {
    void cargarDatosPeriodo();
  }, [cargarDatosPeriodo]);

  const stats = useMemo(() => {
    if (!prestamos) return null;
    return calcularEstadisticasPeriodo(
      prestamos,
      equipos,
      categorias,
      categoriaId,
      toleranciaMin,
      reservasProximas,
    );
  }, [prestamos, equipos, categorias, categoriaId, toleranciaMin, reservasProximas]);

  const aniosDisponibles = useMemo(
    () => [anioActual - 2, anioActual - 1, anioActual, anioActual + 1],
    [anioActual],
  );

  const categoriaNombreActual = useMemo(() => {
    if (!categoriaId) return 'Todas las categorías';
    return categorias.find((c) => c.id_categoria === categoriaId)?.nombre ?? 'Categoría';
  }, [categoriaId, categorias]);

  const maxMes = useMemo(
    () => Math.max(1, ...(stats?.porMes.map((m) => m.efectivos + m.noPresentados + m.cancelados) ?? [1])),
    [stats],
  );
  const maxDia = useMemo(
    () => Math.max(1, ...(stats?.porDiaSemana.map((d) => d.efectivos) ?? [1])),
    [stats],
  );
  const maxFranja = useMemo(
    () => Math.max(1, ...(stats?.porFranja.map((f) => f.cantidad) ?? [1])),
    [stats],
  );
  const maxCat = useMemo(
    () => Math.max(1, ...(stats?.porCategoria.map((c) => c.usosEquipos) ?? [1])),
    [stats],
  );

  const presets: { id: PresetPeriodo; label: string }[] = [
    { id: 'ultimos30', label: 'Últimos 30 días' },
    { id: 'mes', label: 'Este mes' },
    {
      id: 'c1',
      label: `1° Cuatr. (${MESES_CORTOS[cuatrimestresCfg.c1Inicio - 1]}–${MESES_CORTOS[cuatrimestresCfg.c1Fin - 1]})`,
    },
    {
      id: 'c2',
      label: `2° Cuatr. (${MESES_CORTOS[cuatrimestresCfg.c2Inicio - 1]}–${MESES_CORTOS[cuatrimestresCfg.c2Fin - 1]})`,
    },
    { id: 'anio', label: `Año ${anioSeleccionado}` },
    { id: 'personalizado', label: 'Personalizado' },
  ];

  const handleExportar = () => {
    if (!stats) return;
    const f1 = desde <= hasta ? desde : hasta;
    const f2 = desde <= hasta ? hasta : desde;
    exportarEstadisticasExcel(stats, f1, f2, categoriaNombreActual, soloNotebooks);
  };

  const equiposMenosUsadosVisibles = useMemo(
    () =>
      (stats?.equiposMenosUsados ?? []).filter(
        (e) => !soloNotebooks || esCategoriaNotebook(e.categoria),
      ),
    [stats, soloNotebooks],
  );

  const equiposMasUsadosVisibles = useMemo(
    () =>
      (stats?.equiposMasUsados ?? []).filter(
        (e) => !soloNotebooks || esCategoriaNotebook(e.categoria),
      ),
    [stats, soloNotebooks],
  );

  const equiposSinUsoVisibles = useMemo(
    () =>
      (stats?.equiposSinUso ?? []).filter(
        (e) => !soloNotebooks || esCategoriaNotebook(e.categoria),
      ),
    [stats, soloNotebooks],
  );

  const equiposConObservacionesVisibles = useMemo(
    () =>
      (stats?.equiposConObservaciones ?? []).filter(
        (e) => !soloNotebooks || esCategoriaNotebook(e.categoria),
      ),
    [stats, soloNotebooks],
  );

  return (
    <div className="space-y-5">
      {/* Panel de filtros y período */}
      <div className="card space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => aplicarPreset(p.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  preset === p.id
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setEditandoCuatrimestres((v) => !v)}
              className={`btn-secondary px-3 py-1.5 text-xs ${
                editandoCuatrimestres ? 'border-brand-500 text-brand-700 dark:text-brand-300' : ''
              }`}
            >
              <SlidersHorizontal size={14} /> Ajustar meses cuatrimestres
            </button>
            <button
              type="button"
              onClick={handleExportar}
              disabled={cargando || !stats}
              className="btn-primary px-3 py-1.5 text-xs"
            >
              <Download size={14} /> Exportar Excel (.xlsx)
            </button>
          </div>
        </div>

        {/* Configuración de meses de 1° y 2° cuatrimestre */}
        {editandoCuatrimestres && (
          <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3.5 text-xs dark:border-brand-900/50 dark:bg-brand-950/30">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-brand-900 dark:text-brand-100">
                Configurar meses de 1° y 2° Cuatrimestre
              </p>
              <button
                type="button"
                onClick={restablecerCuatrimestres}
                className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline dark:text-brand-300"
              >
                <RotateCcw size={12} /> Restablecer (Mar–Jul / Ago–Dic)
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-brand-200/80 bg-white p-2.5 dark:border-brand-900/40 dark:bg-gray-900">
                <p className="mb-2 font-medium text-gray-800 dark:text-gray-200">1° Cuatrimestre</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] text-gray-500">Desde mes</label>
                    <select
                      className="input h-8 py-1 text-xs"
                      value={cuatrimestresCfg.c1Inicio}
                      onChange={(e) => actualizarCuatrimestreCfg({ c1Inicio: Number(e.target.value) })}
                    >
                      {MESES_NOMBRES.map((m, idx) => (
                        <option key={m} value={idx + 1}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-gray-500">Hasta mes</label>
                    <select
                      className="input h-8 py-1 text-xs"
                      value={cuatrimestresCfg.c1Fin}
                      onChange={(e) => actualizarCuatrimestreCfg({ c1Fin: Number(e.target.value) })}
                    >
                      {MESES_NOMBRES.map((m, idx) => (
                        <option key={m} value={idx + 1} disabled={idx + 1 < cuatrimestresCfg.c1Inicio}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-brand-200/80 bg-white p-2.5 dark:border-brand-900/40 dark:bg-gray-900">
                <p className="mb-2 font-medium text-gray-800 dark:text-gray-200">2° Cuatrimestre</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] text-gray-500">Desde mes</label>
                    <select
                      className="input h-8 py-1 text-xs"
                      value={cuatrimestresCfg.c2Inicio}
                      onChange={(e) => actualizarCuatrimestreCfg({ c2Inicio: Number(e.target.value) })}
                    >
                      {MESES_NOMBRES.map((m, idx) => (
                        <option key={m} value={idx + 1}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-gray-500">Hasta mes</label>
                    <select
                      className="input h-8 py-1 text-xs"
                      value={cuatrimestresCfg.c2Fin}
                      onChange={(e) => actualizarCuatrimestreCfg({ c2Fin: Number(e.target.value) })}
                    >
                      {MESES_NOMBRES.map((m, idx) => (
                        <option key={m} value={idx + 1} disabled={idx + 1 < cuatrimestresCfg.c2Inicio}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Controles de fechas exactas, año y categoría */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(preset === 'c1' || preset === 'c2' || preset === 'anio') && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Año lectivo</label>
              <select
                className="input h-9 py-1 text-sm"
                value={anioSeleccionado}
                onChange={(e) => aplicarPreset(preset, Number(e.target.value))}
              >
                {aniosDisponibles.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Desde</label>
            <input
              type="date"
              className="input h-9 py-1 text-sm"
              value={desde}
              onChange={(e) => {
                setPreset('personalizado');
                setRango((r) => ({ ...r, desde: e.target.value }));
              }}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Hasta</label>
            <input
              type="date"
              className="input h-9 py-1 text-sm"
              value={hasta}
              onChange={(e) => {
                setPreset('personalizado');
                setRango((r) => ({ ...r, hasta: e.target.value }));
              }}
            />
          </div>

          <div className={preset === 'c1' || preset === 'c2' || preset === 'anio' ? '' : 'lg:col-span-2'}>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
              Filtrar por categoría
            </label>
            <select
              className="input h-9 py-1 text-sm"
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
            >
              <option value="">Todas las categorías</option>
              {categorias.map((c) => (
                <option key={c.id_categoria} value={c.id_categoria}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {cargando ? (
        <div className="card flex items-center justify-center gap-2 px-6 py-12 text-sm text-gray-500">
          <BarChart3 size={16} className="animate-pulse text-brand-600" />
          Calculando estadísticas del período…
        </div>
      ) : error ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-10 text-center text-sm text-gray-500">
          <AlertTriangle size={20} className="text-red-600" />
          <p>{error}</p>
          <button type="button" onClick={() => void cargarDatosPeriodo()} className="btn-secondary">
            Reintentar
          </button>
        </div>
      ) : stats ? (
        <>
          {/* KPIs principales */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="card p-4">
              <div className="flex items-center justify-between text-xs font-medium text-gray-500">
                <span>Préstamos efectivos</span>
                <TrendingUp size={15} className="text-brand-600" />
              </div>
              <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
                {stats.prestamosEfectivos}
              </p>
              <p className="mt-0.5 text-[11px] text-gray-500">
                {stats.entregasEquipos} {stats.entregasEquipos === 1 ? 'equipo entregado' : 'equipos entregados'} ·{' '}
                {stats.totalSolicitudes} solicitudes
              </p>
            </div>

            <div className="card p-4">
              <div className="flex items-center justify-between text-xs font-medium text-gray-500">
                <span>Horas totales de uso</span>
                <Clock size={15} className="text-emerald-600" />
              </div>
              <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{stats.horasTotales} h</p>
              <p className="mt-0.5 text-[11px] text-gray-500">
                Promedio: {stats.duracionPromedioMin} min por préstamo
              </p>
            </div>

            <div className="card p-4">
              <div className="flex items-center justify-between text-xs font-medium text-gray-500">
                <span>Puntualidad devoluciones</span>
                <CheckCircle2 size={15} className="text-green-600" />
              </div>
              <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
                {stats.puntualidadPct !== null ? `${stats.puntualidadPct}%` : '—'}
              </p>
              <p className="mt-0.5 text-[11px] text-gray-500">
                {stats.devolucionesEvaluadas > 0
                  ? `${stats.devolucionesATiempo} a tiempo · ${stats.devolucionesTarde} fuera de hora`
                  : 'Sin devoluciones cerradas aún'}
              </p>
            </div>

            <div className="card p-4">
              <div className="flex items-center justify-between text-xs font-medium text-gray-500">
                <span>Ausencias y cancelaciones</span>
                <UserX size={15} className="text-amber-600" />
              </div>
              <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
                {stats.noPresentados} <span className="text-sm font-normal text-gray-400">/ {stats.cancelados}</span>
              </p>
              <p className="mt-0.5 text-[11px] text-gray-500">
                {stats.tasaAusenciaPct}% No Presentado · {stats.tasaCancelacionPct}% Cancelado
              </p>
            </div>
          </div>

          {stats.totalSolicitudes === 0 ? (
            <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-gray-500">
              <CalendarRange size={24} className="text-gray-400" />
              <p>
                No hay reservas ni préstamos registrados entre{' '}
                <strong>{formatearFechaCorta(desde)}</strong> y <strong>{formatearFechaCorta(hasta)}</strong>
                {categoriaId ? ` en ${categoriaNombreActual}` : ''}.
              </p>
            </div>
          ) : (
            <>
              {/* Evolución mensual y demanda horaria */}
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="card space-y-3 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Evolución mensual</h3>
                    <span className="text-[11px] text-gray-500">Efectivos · No presentado · Cancelado</span>
                  </div>
                  <div className="space-y-2.5">
                    {stats.porMes.map((m) => {
                      const totalM = m.efectivos + m.noPresentados + m.cancelados;
                      return (
                        <div key={m.mesKey} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-gray-700 dark:text-gray-200">{m.etiqueta}</span>
                            <span className="text-gray-500">
                              <strong className="text-gray-900 dark:text-white">{m.efectivos}</strong> prést. ·{' '}
                              {m.horas} h
                              {m.noPresentados > 0 ? ` · ${m.noPresentados} aus.` : ''}
                            </span>
                          </div>
                          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                            {m.efectivos > 0 && (
                              <div
                                className="h-full bg-brand-600"
                                style={{ width: `${(m.efectivos / maxMes) * 100}%` }}
                                title={`Efectivos: ${m.efectivos}`}
                              />
                            )}
                            {m.noPresentados > 0 && (
                              <div
                                className="h-full bg-red-400"
                                style={{ width: `${(m.noPresentados / maxMes) * 100}%` }}
                                title={`No Presentado: ${m.noPresentados}`}
                              />
                            )}
                            {m.cancelados > 0 && (
                              <div
                                className="h-full bg-gray-400"
                                style={{ width: `${(m.cancelados / maxMes) * 100}%` }}
                                title={`Cancelados: ${m.cancelados}`}
                              />
                            )}
                            {totalM === 0 && <div className="h-full w-0" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="card space-y-4 p-4">
                  <div>
                    <h3 className="mb-2.5 text-sm font-semibold text-gray-900 dark:text-white">
                      Franjas horarias pico
                    </h3>
                    {stats.porFranja.length === 0 ? (
                      <p className="text-xs text-gray-500">Sin préstamos efectivos en el período.</p>
                    ) : (
                      <div className="space-y-2">
                        {stats.porFranja.map((f) => (
                          <div key={f.hora} className="flex items-center gap-2 text-xs">
                            <span className="w-14 shrink-0 font-mono text-gray-700 dark:text-gray-200">
                              {f.hora} hs
                            </span>
                            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                              <div
                                className="h-full rounded-full bg-emerald-500"
                                style={{ width: `${(f.cantidad / maxFranja) * 100}%` }}
                              />
                            </div>
                            <span className="w-16 shrink-0 text-right text-gray-600 dark:text-gray-300">
                              {f.cantidad} ({f.porcentaje}%)
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Demanda por día de la semana
                    </h4>
                    <div className="grid grid-cols-7 gap-1.5 text-center">
                      {stats.porDiaSemana.map((d) => (
                        <div key={d.dia} className="rounded-lg bg-gray-50 p-1.5 dark:bg-gray-900">
                          <div className="mx-auto mb-1 flex h-10 w-3 items-end overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                            <div
                              className="w-full rounded-full bg-brand-600"
                              style={{ height: `${Math.round((d.efectivos / maxDia) * 100)}%` }}
                            />
                          </div>
                          <p className="text-[11px] font-medium text-gray-700 dark:text-gray-200">{d.dia}</p>
                          <p className="text-[10px] text-gray-500">{d.efectivos}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Desgloses por categoría y curso */}
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="card space-y-3 p-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Uso por categoría</h3>
                  {stats.porCategoria.length === 0 ? (
                    <p className="text-xs text-gray-500">Sin entregas en el período.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {stats.porCategoria.map((c) => (
                        <div key={c.id_categoria} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-gray-800 dark:text-gray-200">{c.nombre}</span>
                            <span className="text-gray-500">
                              <strong className="text-gray-900 dark:text-white">{c.usosEquipos}</strong> usos ·{' '}
                              {c.horas} h
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                            <div
                              className="h-full rounded-full bg-brand-600"
                              style={{ width: `${(c.usosEquipos / maxCat) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="card space-y-3 p-4">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Uso por curso</h3>
                  <div className="space-y-2.5">
                    {stats.porCurso.map((c) => (
                      <div key={c.curso} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-gray-800 dark:text-gray-200">{c.curso}</span>
                          <span className="text-gray-500">
                            <strong className="text-gray-900 dark:text-white">{c.prestamos}</strong> prést. (
                            {c.porcentaje}%) · {c.equipos} eq.
                            {c.noPresentados > 0 ? ` · ${c.noPresentados} aus.` : ''}
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                          <div
                            className="h-full rounded-full bg-amber-500 transition-all"
                            style={{ width: `${c.porcentaje}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Salud y ranking por equipo */}
              <div className="card space-y-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                    {soloNotebooks
                      ? 'Detalle de Notebooks en el período'
                      : 'Detalle por equipo en el período'}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <button
                        type="button"
                        onClick={() => setSubVistaEquipos('menos_usados')}
                        className={`rounded-lg px-2.5 py-1 font-medium transition ${
                          subVistaEquipos === 'menos_usados'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-200'
                        }`}
                      >
                        Menos usados ({equiposMenosUsadosVisibles.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setSubVistaEquipos('mas_usados')}
                        className={`rounded-lg px-2.5 py-1 font-medium transition ${
                          subVistaEquipos === 'mas_usados'
                            ? 'bg-brand-600 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
                        }`}
                      >
                        Más utilizados ({equiposMasUsadosVisibles.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setSubVistaEquipos('sin_uso')}
                        className={`rounded-lg px-2.5 py-1 font-medium transition ${
                          subVistaEquipos === 'sin_uso'
                            ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
                        }`}
                      >
                        Sin uso ({equiposSinUsoVisibles.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setSubVistaEquipos('observaciones')}
                        className={`rounded-lg px-2.5 py-1 font-medium transition ${
                          subVistaEquipos === 'observaciones'
                            ? 'bg-amber-600 text-white'
                            : 'bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200'
                        }`}
                      >
                        Con observaciones / mant. ({equiposConObservacionesVisibles.length})
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                  <span>
                    {subVistaEquipos === 'menos_usados'
                      ? 'Ordenado de menor a mayor uso (ideal para recomendar equipos con menos desgaste para proyectos).'
                      : subVistaEquipos === 'mas_usados'
                        ? 'Ordenado de mayor a menor uso dentro del período.'
                        : subVistaEquipos === 'sin_uso'
                          ? 'Equipos operativos que no registraron usos en el período.'
                          : 'Equipos en mantenimiento o con observaciones registradas en devoluciones.'}
                  </span>
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={soloNotebooks}
                        onChange={(e) => setSoloNotebooks(e.target.checked)}
                        className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      />
                      Solo Notebooks
                    </label>
                    {(subVistaEquipos === 'menos_usados' || subVistaEquipos === 'mas_usados') && (
                      <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-gray-700 dark:text-gray-300">
                        <input
                          type="checkbox"
                          checked={soloDisponibles}
                          onChange={(e) => setSoloDisponibles(e.target.checked)}
                          className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                        />
                        Solo disponibles ahora
                      </label>
                    )}
                  </div>
                </div>

                {(subVistaEquipos === 'menos_usados' || subVistaEquipos === 'mas_usados') && (() => {
                  const base =
                    subVistaEquipos === 'menos_usados'
                      ? equiposMenosUsadosVisibles
                      : equiposMasUsadosVisibles;
                  const lista = soloDisponibles
                    ? base.filter((e) => e.estadoActual === 'Disponible')
                    : base;

                  if (lista.length === 0) {
                    return (
                      <p className="py-4 text-center text-xs text-gray-500">
                        {soloDisponibles
                          ? `No hay ${soloNotebooks ? 'notebooks' : 'equipos'} disponibles que coincidan con esta vista.`
                          : `Ninguna ${soloNotebooks ? 'notebook' : 'unidad'} coincide con el filtro actual.`}
                      </p>
                    );
                  }

                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-gray-200 text-[11px] uppercase text-gray-500 dark:border-gray-800">
                          <tr>
                            <th className="py-2 pr-3">Equipo</th>
                            <th className="py-2 pr-3">Categoría</th>
                            <th className="py-2 pr-3">Estado actual</th>
                            <th className="py-2 pr-3 text-right">Usos</th>
                            <th className="py-2 pr-3 text-right">Horas</th>
                            <th className="py-2 pr-3">Último uso</th>
                            <th className="py-2 pr-3 text-right">Reservas próx.</th>
                            <th className="py-2 text-right">Obs.</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                          {lista.map((e) => (
                            <tr key={e.id_equipo}>
                              <td className="py-2 pr-3">
                                <span className="font-semibold text-gray-900 dark:text-white">
                                  {e.codigo_inventario}
                                </span>{' '}
                                <span className="text-gray-500">· {e.marca_modelo}</span>
                              </td>
                              <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">{e.categoria}</td>
                              <td className="py-2 pr-3">
                                <Badge variant={estadoEquipoVariant(e.estadoActual)}>{e.estadoActual}</Badge>
                              </td>
                              <td className="py-2 pr-3 text-right font-semibold text-gray-900 dark:text-white">
                                {e.usos}
                              </td>
                              <td className="py-2 pr-3 text-right text-gray-600 dark:text-gray-300">{e.horas} h</td>
                              <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">
                                {e.ultimoUso ?? <span className="italic text-gray-400">Sin usos</span>}
                              </td>
                              <td className="py-2 pr-3 text-right">
                                {e.reservasProximas > 0 ? (
                                  <Badge variant="yellow">{e.reservasProximas}</Badge>
                                ) : (
                                  <span className="text-gray-400">0</span>
                                )}
                              </td>
                              <td className="py-2 text-right text-gray-500">{e.observacionesCount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                {subVistaEquipos === 'sin_uso' && (
                  equiposSinUsoVisibles.length === 0 ? (
                    <p className="py-4 text-center text-xs text-gray-500">
                      {soloNotebooks
                        ? 'Todas las notebooks operativas se usaron al menos una vez en este período.'
                        : 'Todos los equipos operativos se usaron al menos una vez en este período.'}
                    </p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                      {equiposSinUsoVisibles.map((e) => (
                        <div
                          key={e.id_equipo}
                          className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs dark:border-gray-800"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-gray-900 dark:text-white">
                              {e.codigo_inventario}
                            </p>
                            <p className="truncate text-[11px] text-gray-500">
                              {e.categoria} · {e.marca_modelo}
                            </p>
                          </div>
                          <Badge variant={estadoEquipoVariant(e.estadoActual)}>{e.estadoActual}</Badge>
                        </div>
                      ))}
                    </div>
                  )
                )}

                {subVistaEquipos === 'observaciones' && (
                  equiposConObservacionesVisibles.length === 0 ? (
                    <p className="py-4 text-center text-xs text-gray-500">
                      {soloNotebooks
                        ? 'No hubo observaciones ni notebooks en mantenimiento en este período.'
                        : 'No hubo observaciones ni equipos en mantenimiento en este período.'}
                    </p>
                  ) : (
                    <ul className="divide-y divide-gray-100 text-xs dark:divide-gray-800">
                      {equiposConObservacionesVisibles.map((e) => (
                        <li key={e.id_equipo} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                          <div className="min-w-0 space-y-0.5">
                            <p className="font-semibold text-gray-900 dark:text-white">
                              {e.codigo_inventario}{' '}
                              <span className="font-normal text-gray-500">
                                · {e.categoria} · {e.marca_modelo}
                              </span>
                            </p>
                            {e.ultimaNota && (
                              <p className="text-gray-600 dark:text-gray-300">Última nota: {e.ultimaNota}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {e.observacionesCount > 0 && (
                              <Badge variant="yellow">{e.observacionesCount} reg.</Badge>
                            )}
                            <Badge variant={estadoEquipoVariant(e.estadoActual)}>{e.estadoActual}</Badge>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
