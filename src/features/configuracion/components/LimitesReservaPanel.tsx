import { useEffect, useState } from 'react';
import {
  AlertCircle, CheckCircle, Clock, Plus, Settings, Sparkles, Trash2, } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import type { Categoria, ConfiguracionHorarios, FranjaRetiro } from '@/types/database';
import {
  LIMITE_MAX,
  LIMITE_MIN,
  actualizarLimiteCategoria,
  cargarCategorias,
} from '@/features/prestamos/services/prestamosService';
import {
  CONFIGURACION_HORARIOS_DEFECTO,
  aMinutos,
  cargarConfiguracionHorarios,
  generarGrillaFranjas,
  guardarConfiguracionHorarios,
} from '@/features/configuracion/services/horariosService';

const SIN_LIMITE = 'sin';
const OPCIONES = Array.from({ length: LIMITE_MAX - LIMITE_MIN + 1 }, (_, i) => String(LIMITE_MIN + i));

function valorOriginal(c: Categoria) {
  return c.limite_alumnos === null ? SIN_LIMITE : String(c.limite_alumnos);
}

export default function LimitesReservaPanel() {
  const { session } = useAuth();
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [borradores, setBorradores] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [guardandoId, setGuardandoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  // Configuración de franjas de retiro, tolerancia y devolución
  const [horarios, setHorarios] = useState<ConfiguracionHorarios>(CONFIGURACION_HORARIOS_DEFECTO);
  const [horariosGuardados, setHorariosGuardados] = useState<ConfiguracionHorarios>(
    CONFIGURACION_HORARIOS_DEFECTO,
  );
  const [cargandoHorarios, setCargandoHorarios] = useState(true);
  const [guardandoHorarios, setGuardandoHorarios] = useState(false);
  const [errorHorarios, setErrorHorarios] = useState<string | null>(null);
  const [exitoHorarios, setExitoHorarios] = useState<string | null>(null);

  // Generador rápido de franjas
  const [mostrarGenerador, setMostrarGenerador] = useState(false);
  const [genInicio, setGenInicio] = useState('08:00');
  const [genDuracion, setGenDuracion] = useState(80);
  const [genRecreo, setGenRecreo] = useState(10);
  const [genAnticipacion, setGenAnticipacion] = useState(15);
  const [genPrimeraDesde, setGenPrimeraDesde] = useState('07:50');
  const [genPrimeraHasta, setGenPrimeraHasta] = useState('08:10');
  const [genCantidad, setGenCantidad] = useState(9);

  useEffect(() => {
    let active = true;
    cargarCategorias()
      .then((c) => {
        if (!active) return;
        setCategorias(c);
        setCargando(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'No se pudieron cargar las categorías');
        setCargando(false);
      });

    cargarConfiguracionHorarios()
      .then((cfg) => {
        if (!active) return;
        setHorarios(cfg);
        setHorariosGuardados(cfg);
        setCargandoHorarios(false);
      })
      .catch(() => {
        if (!active) return;
        setCargandoHorarios(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const hayCambiosHorarios = JSON.stringify(horarios) !== JSON.stringify(horariosGuardados);

  const valorActual = (c: Categoria) => borradores[c.id_categoria] ?? valorOriginal(c);

  const guardar = async (c: Categoria) => {
    if (!session) return;
    setError(null);
    setExito(null);
    const valor = valorActual(c);
    setGuardandoId(c.id_categoria);
    try {
      const guardado = await actualizarLimiteCategoria(
        session.token,
        c.id_categoria,
        valor === SIN_LIMITE ? null : Number(valor),
      );
      setCategorias((prev) =>
        prev.map((x) => (x.id_categoria === c.id_categoria ? { ...x, limite_alumnos: guardado } : x)),
      );
      setBorradores((prev) => {
        const next = { ...prev };
        delete next[c.id_categoria];
        return next;
      });
      setExito(
        guardado === null
          ? `${c.nombre} quedó sin límite.`
          : `El límite de ${c.nombre} se actualizó a ${guardado} por estudiante.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el límite');
    } finally {
      setGuardandoId(null);
    }
  };

  const actualizarFranja = (idx: number, campo: keyof FranjaRetiro, valor: string) => {
    setExitoHorarios(null);
    setHorarios((prev) => ({
      ...prev,
      franjas: prev.franjas.map((f, i) => (i === idx ? { ...f, [campo]: valor } : f)),
    }));
  };

  const agregarFranja = () => {
    setExitoHorarios(null);
    setHorarios((prev) => ({
      ...prev,
      franjas: [
        ...prev.franjas,
        {
          id: `f-${Date.now()}`,
          etiqueta: `${prev.franjas.length + 1}ª hora`,
          retiro_desde: '09:15',
          retiro_hasta: '09:30',
          hora_clase: '09:30',
        },
      ],
    }));
  };

  const eliminarFranja = (idx: number) => {
    setExitoHorarios(null);
    setHorarios((prev) => ({
      ...prev,
      franjas: prev.franjas.filter((_, i) => i !== idx),
    }));
  };

  const aplicarGenerador = () => {
    const nuevas = generarGrillaFranjas({
      horaPrimeraClase: genInicio,
      duracionClaseMin: genDuracion,
      recreoMin: genRecreo,
      anticipacionMin: genAnticipacion,
      primeraDesde: genPrimeraDesde,
      primeraHasta: genPrimeraHasta,
      cantidad: genCantidad,
      horaCierre: horarios.hora_cierre_devolucion,
    });
    setHorarios((prev) => ({ ...prev, franjas: nuevas }));
    setMostrarGenerador(false);
    setExitoHorarios(
      `Se generó la grilla hasta antes de las ${horarios.hora_cierre_devolucion} hs (${nuevas.length} franjas). Tocá "Guardar configuración de horarios" para aplicarla.`,
    );
    setErrorHorarios(null);
  };

  const guardarHorarios = async () => {
    if (!session) return;
    setErrorHorarios(null);
    setExitoHorarios(null);

    if (horarios.tolerancia_retiro_min < 0 || horarios.tolerancia_retiro_min > 60) {
      setErrorHorarios('La tolerancia debe estar entre 0 y 60 minutos.');
      return;
    }

    if (horarios.dias_anticipacion_max < 0 || horarios.dias_anticipacion_max > 90) {
      setErrorHorarios('Los días máximos de anticipación deben estar entre 0 y 90.');
      return;
    }

    if (horarios.franjas_activas && horarios.franjas.length === 0) {
      setErrorHorarios('Agregá al menos una franja de retiro o desactivá la restricción.');
      return;
    }

    for (const f of horarios.franjas) {
      if (!f.retiro_desde || !f.retiro_hasta || !f.hora_clase) {
        setErrorHorarios('Completá todos los horarios en cada franja.');
        return;
      }
      if (aMinutos(f.retiro_hasta) <= aMinutos(f.retiro_desde)) {
        setErrorHorarios(`En "${f.etiqueta}", la hora "Hasta" debe ser posterior a "Desde".`);
        return;
      }
    }

    setGuardandoHorarios(true);
    try {
      const guardado = await guardarConfiguracionHorarios(session.token, {
        franjas_activas: horarios.franjas_activas,
        tolerancia_retiro_min: horarios.tolerancia_retiro_min,
        hora_cierre_devolucion: horarios.hora_cierre_devolucion,
        dias_anticipacion_max: horarios.dias_anticipacion_max,
        permitir_fines_de_semana: horarios.permitir_fines_de_semana,
        franjas: horarios.franjas,
      });
      setHorarios(guardado);
      setHorariosGuardados(guardado);
      setExitoHorarios('Configuración de horarios guardada correctamente.');
    } catch (err) {
      setErrorHorarios(err instanceof Error ? err.message : 'No se pudo guardar la configuración.');
    } finally {
      setGuardandoHorarios(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Card 1: Límites por categoría */}
      <div className="card p-6">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
          <Settings size={18} className="text-brand-600" /> Límites de reserva por categoría
        </h2>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          Cantidad máxima de equipos de cada categoría que un estudiante puede tener reservados o en curso al mismo
          tiempo. Las categorías sin límite no tienen restricción. Profesores y administrativos no tienen límite.
        </p>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {exito && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircle size={16} className="mt-0.5 shrink-0" />
            <span>{exito}</span>
          </div>
        )}

        {cargando ? (
          <p className="py-8 text-center text-sm text-gray-500">Cargando categorías…</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {categorias.map((c) => {
              const valor = valorActual(c);
              const cambiado = valor !== valorOriginal(c);
              return (
                <li key={c.id_categoria} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-[10rem] flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{c.nombre}</p>
                    <p className="text-xs text-gray-500">
                      {c.limite_alumnos === null ? 'Sin límite' : `Máximo ${c.limite_alumnos} por estudiante`}
                    </p>
                  </div>
                  <select
                    className="input w-40"
                    value={valor}
                    onChange={(e) =>
                      setBorradores((prev) => ({ ...prev, [c.id_categoria]: e.target.value }))
                    }
                  >
                    <option value={SIN_LIMITE}>Sin límite</option>
                    {OPCIONES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!cambiado || guardandoId !== null}
                    onClick={() => guardar(c)}
                    className="btn-secondary h-9 px-3 text-sm"
                  >
                    {guardandoId === c.id_categoria ? 'Guardando…' : 'Guardar'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Card 2: Franjas de retiro, tolerancia y hora de devolución */}
      <div className="card p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
              <Clock size={18} className="text-brand-600" /> Franjas de retiro y tolerancia
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Definí los horarios habilitados para retirar equipos en el pañol (inicio de clase y recreos) y los
              minutos de tolerancia. Las devoluciones pueden hacerse en cualquier horario hasta el cierre.
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium dark:border-gray-800">
            <input
              type="checkbox"
              checked={horarios.franjas_activas}
              onChange={(e) => {
                setExitoHorarios(null);
                setHorarios((prev) => ({ ...prev, franjas_activas: e.target.checked }));
              }}
              className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            <span>Restringir por franjas</span>
          </label>
        </div>

        {cargandoHorarios ? (
          <p className="py-8 text-center text-sm text-gray-500">Cargando configuración horaria…</p>
        ) : (
          <div className="space-y-5">
            {/* Parámetros generales */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                  Tolerancia de retiro (min)
                </label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  className="input"
                  value={horarios.tolerancia_retiro_min}
                  onChange={(e) => {
                    setExitoHorarios(null);
                    setHorarios((prev) => ({
                      ...prev,
                      tolerancia_retiro_min: Math.max(0, Math.min(60, Number(e.target.value) || 0)),
                    }));
                  }}
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Pasada la franja + tolerancia, no se entrega y caduca a No Presentado.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                  Hora máxima de devolución (cierre)
                </label>
                <input
                  type="time"
                  className="input"
                  value={horarios.hora_cierre_devolucion}
                  onChange={(e) => {
                    setExitoHorarios(null);
                    setHorarios((prev) => ({ ...prev, hora_cierre_devolucion: e.target.value }));
                  }}
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Las franjas y retiros iguales o posteriores a esta hora se ocultan automáticamente al alumno.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
                  Días máximos de anticipación
                </label>
                <input
                  type="number"
                  min={0}
                  max={90}
                  className="input"
                  value={horarios.dias_anticipacion_max}
                  onChange={(e) => {
                    setExitoHorarios(null);
                    setHorarios((prev) => ({
                      ...prev,
                      dias_anticipacion_max: Math.max(0, Math.min(90, Number(e.target.value) || 0)),
                    }));
                  }}
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Cantidad máxima de días hacia adelante para reservar (0 = solo para hoy; ej. 7 = hasta la próxima semana).
                </p>
              </div>

              <div className="flex flex-col justify-center">
                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-gray-200 p-3 text-sm dark:border-gray-800">
                  <input
                    type="checkbox"
                    checked={horarios.permitir_fines_de_semana}
                    onChange={(e) => {
                      setExitoHorarios(null);
                      setHorarios((prev) => ({ ...prev, permitir_fines_de_semana: e.target.checked }));
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span>
                    <span className="block font-medium text-gray-800 dark:text-gray-100">
                      Permitir reservas sábados y domingos
                    </span>
                    <span className="block text-[11px] text-gray-500">
                      Desactivalo si el pañol atiende únicamente de lunes a viernes.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            {/* Botonera franjas */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
              <div>
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                  Franjas habilitadas para retirar ({horarios.franjas.length})
                </h3>
                <p className="text-xs text-gray-500">
                  El alumno solo puede retirar entre «Desde» y «Hasta» (+{horarios.tolerancia_retiro_min} min).
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setMostrarGenerador((s) => !s)}
                  className="btn-secondary h-9 px-3 text-xs"
                >
                  <Sparkles size={14} /> {mostrarGenerador ? 'Cerrar generador' : 'Generar grilla'}
                </button>
                <button type="button" onClick={agregarFranja} className="btn-secondary h-9 px-3 text-xs">
                  <Plus size={14} /> Agregar franja
                </button>
              </div>
            </div>

            {/* Generador automático opcional */}
            {mostrarGenerador && (
              <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 dark:border-brand-900/50 dark:bg-brand-950/20">
                <p className="mb-3 text-xs font-semibold text-brand-800 dark:text-brand-200">
                  Generador rápido según duración de clase y recreo
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs text-gray-600 dark:text-gray-300">1ª clase</label>
                    <input
                      type="time"
                      className="input"
                      value={genInicio}
                      onChange={(e) => setGenInicio(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-600 dark:text-gray-300">
                      Duración clase (min)
                    </label>
                    <input
                      type="number"
                      min={20}
                      max={240}
                      className="input"
                      value={genDuracion}
                      onChange={(e) => setGenDuracion(Number(e.target.value) || 80)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-600 dark:text-gray-300">Recreo (min)</label>
                    <input
                      type="number"
                      min={0}
                      max={60}
                      className="input"
                      value={genRecreo}
                      onChange={(e) => setGenRecreo(Number(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-600 dark:text-gray-300">
                      Retiro antes (min)
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={60}
                      className="input"
                      value={genAnticipacion}
                      onChange={(e) => setGenAnticipacion(Number(e.target.value) || 15)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-600 dark:text-gray-300">
                      1ª franja (Desde / Hasta)
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="time"
                        className="input px-2"
                        value={genPrimeraDesde}
                        onChange={(e) => setGenPrimeraDesde(e.target.value)}
                      />
                      <input
                        type="time"
                        className="input px-2"
                        value={genPrimeraHasta}
                        onChange={(e) => setGenPrimeraHasta(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-600 dark:text-gray-300">Cantidad módulos</label>
                    <input
                      type="number"
                      min={1}
                      max={15}
                      className="input"
                      value={genCantidad}
                      onChange={(e) => setGenCantidad(Math.max(1, Math.min(15, Number(e.target.value) || 1)))}
                    />
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <button type="button" onClick={aplicarGenerador} className="btn-primary h-9 px-4 text-xs">
                    Aplicar grilla
                  </button>
                </div>
              </div>
            )}

            {/* Lista editable de franjas */}
            {horarios.franjas.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-300 py-6 text-center text-sm text-gray-500 dark:border-gray-700">
                No hay franjas cargadas. Agregá una o usá el generador.
              </p>
            ) : (
              <div className="space-y-2">
                {horarios.franjas.map((f, idx) => {
                  const cierreMin = aMinutos(horarios.hora_cierre_devolucion || '22:00');
                  const ocultaPorCierre =
                    aMinutos(f.hora_clase) >= cierreMin || aMinutos(f.retiro_hasta) >= cierreMin;
                  return (
                    <div
                      key={f.id || idx}
                      className={`rounded-xl border p-3 ${
                        ocultaPorCierre
                          ? 'border-amber-200 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/10'
                          : 'border-gray-200 dark:border-gray-800'
                      }`}
                    >
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto] sm:items-end">
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-gray-500">
                            Nombre / Turno
                          </label>
                          <input
                            className="input h-9 text-sm"
                            value={f.etiqueta}
                            onChange={(e) => actualizarFranja(idx, 'etiqueta', e.target.value)}
                            placeholder="Ej: 2ª hora (09:30)"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-gray-500">Retiro desde</label>
                          <input
                            type="time"
                            className="input h-9 text-sm"
                            value={f.retiro_desde}
                            onChange={(e) => actualizarFranja(idx, 'retiro_desde', e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-gray-500">Retiro hasta</label>
                          <input
                            type="time"
                            className="input h-9 text-sm"
                            value={f.retiro_hasta}
                            onChange={(e) => actualizarFranja(idx, 'retiro_hasta', e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-gray-500">Inicio clase</label>
                          <input
                            type="time"
                            className="input h-9 text-sm"
                            value={f.hora_clase}
                            onChange={(e) => actualizarFranja(idx, 'hora_clase', e.target.value)}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => eliminarFranja(idx)}
                          className="btn-ghost h-9 w-9 justify-self-end !px-0 text-red-500 hover:text-red-600"
                          title="Eliminar franja"
                          aria-label="Eliminar franja"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      {ocultaPorCierre && (
                        <p className="mt-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                          Oculta para alumnos: supera o iguala la hora máxima de devolución (
                          {horarios.hora_cierre_devolucion} hs).
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="space-y-3 border-t border-gray-100 pt-4 dark:border-gray-800">
              {errorHorarios && (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{errorHorarios}</span>
                </div>
              )}
              {exitoHorarios && (
                <div className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <CheckCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{exitoHorarios}</span>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {hayCambiosHorarios ? 'Tenés cambios sin guardar.' : 'Todo guardado al día.'}
                </span>
                <button
                  type="button"
                  disabled={guardandoHorarios}
                  onClick={() => void guardarHorarios()}
                  className="btn-primary"
                >
                  {guardandoHorarios ? 'Guardando…' : 'Guardar configuración de horarios'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
