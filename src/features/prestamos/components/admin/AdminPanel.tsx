import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeftRight, Calendar, ChevronLeft, ChevronRight, ClipboardList, Clock, PackageCheck, PlusCircle, PackageX, QrCode, Search, ShieldCheck, Users, X, } from 'lucide-react';
import { supabase } from '@/services/supabaseClient';
import type { ConfiguracionHorarios, DetallePrestamo, Equipo, Prestamo, Usuario } from '@/types/database';
import { useAuth } from '@/context/AuthContext';
import {
  ordenarPrestamosPorPrioridad,
  verificarYCaducarReservasVencidas,
} from '@/features/prestamos/services/prestamosService';
import {
  CONFIGURACION_HORARIOS_DEFECTO,
  aHHMM,
  aMinutos,
  bloquesSeSolapan,
  cargarConfiguracionHorarios,
  evaluarVentanaRetiro,
  evaluarVencimientoPrestamoEnCurso,
  normalizarHHMM,
  type EstadoVencimientoPrestamo,
} from '@/features/configuracion/services/horariosService';
import { fechaLocalISO, horaLocalHHMMSS } from '@/utils/fechas';
import {
  buscarPrestamoPorCodigo,
  etiquetaMetodoDevolucion,
  etiquetaMetodoEntrega,
} from '@/features/prestamos/services/qrRetiroService';
import Badge, { estadoPrestamoVariant, estadoUsuarioVariant } from '@/components/ui/Badge';
import CambiarEquipoModal from '@/features/prestamos/components/CambiarEquipoModal';
import EscanearRetiroModal from '@/features/prestamos/components/EscanearRetiroModal';
import EntregaDevolucionModal, { type ResultadoEntregaDevolucion } from '@/features/prestamos/components/EntregaDevolucionModal';

type PrestamoAdmin = Prestamo & {
  usuarios?: Pick<Usuario, 'id_usuario' | 'dni' | 'nombre' | 'apellido' | 'estado'>;
  detalle_prestamos?: (DetallePrestamo & { equipos?: Equipo & { categorias_equipo?: any } })[];
};

type FiltroPrestamos = 'todos' | 'Reservado' | 'En Curso' | 'Devuelto';

type ReservaBloqueHoy = {
  inicio: string;
  fin: string;
};

function sumarDias(fecha: string, dias: number) {
  const [year, month, day] = fecha.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + dias);
  return fechaLocalISO(date);
}

function formatoFecha(fecha: string) {
  const [year, month, day] = fecha.split('-');
  return `${day}/${month}/${year}`;
}

function formatoHora(fecha: string | null) {
  if (!fecha) return '—';
  return new Date(fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

export default function AdminPanel({
  codigoRetiroInicial,
  onConsumirCodigoRetiro,
}: {
  codigoRetiroInicial?: string | null;
  onConsumirCodigoRetiro?: () => void;
}) {
  const { session } = useAuth();
  const [dni, setDni] = useState('');
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [prestamos, setPrestamos] = useState<PrestamoAdmin[]>([]);
  const [prestamosFecha, setPrestamosFecha] = useState<PrestamoAdmin[]>([]);
  const [loading, setLoading] = useState(false);
  const [reservasCaducadas, setReservasCaducadas] = useState(0);
  const [scanOpen, setScanOpen] = useState(false);
  const [avisoQr, setAvisoQr] = useState<{ tipo: 'exito' | 'error'; texto: string } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<{
    tipo: 'entregar' | 'recibir';
    id_prestamo: string;
    metodo?: 'manual' | 'qr' | 'codigo';
    prestamoDirecto?: PrestamoAdmin;
  } | null>(null);
  const [swapPrestamo, setSwapPrestamo] = useState<PrestamoAdmin | null>(null);
  const [fechaFiltro, setFechaFiltro] = useState(() => fechaLocalISO());
  const [showSelectedDate, setShowSelectedDate] = useState(true);
  const [filtroPrestamos, setFiltroPrestamos] = useState<FiltroPrestamos>('todos');
  const [usuariosSugeridos, setUsuariosSugeridos] = useState<Usuario[]>([]);
  const [buscandoUsuarios, setBuscandoUsuarios] = useState(false);
  const [mostrarSugerencias, setMostrarSugerencias] = useState(false);
  const buscadorRef = useRef<HTMLDivElement>(null);
  const omitirSiguienteSugerencia = useRef(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickDni, setQuickDni] = useState('');
  const [quickUser, setQuickUser] = useState<Usuario | null>(null);
  const [quickError, setQuickError] = useState('');
  const [quickValidating, setQuickValidating] = useState(false);
  const [quickSaving, setQuickSaving] = useState(false);
  const [equiposDisponibles, setEquiposDisponibles] = useState<Equipo[]>([]);
  const [configHorarios, setConfigHorarios] = useState<ConfiguracionHorarios>(
    CONFIGURACION_HORARIOS_DEFECTO,
  );
  const [prestamosEnCursoActivos, setPrestamosEnCursoActivos] = useState<PrestamoAdmin[]>([]);
  const [ahoraTick, setAhoraTick] = useState(() => new Date());
  const [reservasHoyEquipo, setReservasHoyEquipo] = useState<Record<string, ReservaBloqueHoy[]>>({});
  const [equiposSeleccionados, setEquiposSeleccionados] = useState<Record<string, string>>({});
  const [quickObs, setQuickObs] = useState('');
  const [quickHoraInicio, setQuickHoraInicio] = useState('');
  const [quickHoraFin, setQuickHoraFin] = useState('');
  const [quickCategoria, setQuickCategoria] = useState('all');
  const [quickUsuariosSugeridos, setQuickUsuariosSugeridos] = useState<Usuario[]>([]);
  const [quickBuscandoUsuarios, setQuickBuscandoUsuarios] = useState(false);
  const [quickMostrarSugerencias, setQuickMostrarSugerencias] = useState(false);
  const quickBuscadorRef = useRef<HTMLDivElement>(null);

  const buscar = async (documento = dni.trim()) => {
    setLoading(true);
    setNotFound(false);
    setUsuario(null);
    setPrestamos([]);
    const d = documento;
    if (!d) {
      setLoading(false);
      return;
    }
    const { data: u } = await supabase
      .from('usuarios')
      .select('id_usuario, dni, nombre, apellido, email, estado, usuario_roles(roles(*))')
      .eq('dni', d)
      .maybeSingle();
    if (!u) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setUsuario(u as unknown as Usuario);
    const { data: p } = await supabase
      .from('prestamos')
      .select('*, usuarios(id_usuario, dni, nombre, apellido, estado), detalle_prestamos(*, equipos(*, categorias_equipo(*)))')
      .eq('id_usuario', (u as any).id_usuario)
      .order('fecha_prestamo', { ascending: false })
      .order('hora_inicio_prevista', { ascending: false });
    setPrestamos(ordenarPrestamosPorPrioridad((p ?? []) as PrestamoAdmin[]));
    setLoading(false);
  };

  const cargarPrestamosPorFecha = async (fecha: string, silencioso = false) => {
    if (!silencioso) setLoading(true);
    const { data } = await supabase
      .from('prestamos')
      .select('*, usuarios(id_usuario, dni, nombre, apellido, estado), detalle_prestamos(*, equipos(*, categorias_equipo(*)))')
      .eq('fecha_prestamo', fecha)
      .order('hora_inicio_prevista');
    setPrestamosFecha(ordenarPrestamosPorPrioridad((data ?? []) as PrestamoAdmin[]));
    if (!silencioso) setLoading(false);
  };

  const cargarPrestamosEnCursoActivos = async () => {
    const { data } = await supabase
      .from('prestamos')
      .select('*, usuarios(id_usuario, dni, nombre, apellido, estado), detalle_prestamos(*, equipos(*, categorias_equipo(*)))')
      .eq('estado', 'En Curso')
      .order('fecha_prestamo')
      .order('hora_fin_prevista');
    setPrestamosEnCursoActivos(ordenarPrestamosPorPrioridad((data ?? []) as PrestamoAdmin[]));
  };

  useEffect(() => {
    void cargarPrestamosPorFecha(fechaFiltro);
  }, [fechaFiltro]);

  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const [cfg, canceladas] = await Promise.all([
          cargarConfiguracionHorarios().catch(() => CONFIGURACION_HORARIOS_DEFECTO),
          verificarYCaducarReservasVencidas().catch(() => 0),
        ]);
        if (!activo) return;
        setConfigHorarios(cfg);
        await cargarPrestamosEnCursoActivos();
        if (!activo || canceladas === 0) return;
        setReservasCaducadas(canceladas);
        void cargarPrestamosPorFecha(fechaFiltro);
      } catch {
        return;
      }
    })();

    const intervalo = window.setInterval(() => {
      setAhoraTick(new Date());
      void cargarPrestamosEnCursoActivos();
      void cargarPrestamosPorFecha(fechaFiltro, true);
    }, 60_000);

    return () => {
      activo = false;
      window.clearInterval(intervalo);
    };
  }, [fechaFiltro]);

  useEffect(() => {
    if (!codigoRetiroInicial || !session) return;
    let activo = true;
    (async () => {
      try {
        const [prestamo, cfg] = await Promise.all([
          buscarPrestamoPorCodigo(session.token, codigoRetiroInicial),
          cargarConfiguracionHorarios().catch(() => ({ tolerancia_retiro_min: 5 })),
        ]);
        if (!activo) return;
        if (prestamo.estado !== 'Reservado' && prestamo.estado !== 'En Curso') {
          setAvisoQr({
            tipo: 'error',
            texto: `El préstamo ${prestamo.codigo_retiro} figura como "${prestamo.estado}" y no admite entrega ni devolución.`,
          });
          return;
        }
        if (prestamo.estado === 'Reservado') {
          const ventana = evaluarVentanaRetiro(prestamo, cfg.tolerancia_retiro_min);
          if (ventana.estado !== 'sin_franja' && ventana.estado !== 'en_horario') {
            if (ventana.estado === 'vencido') {
              await verificarYCaducarReservasVencidas().catch(() => undefined);
              void cargarPrestamosPorFecha(fechaFiltro);
            }
            setAvisoQr({ tipo: 'error', texto: ventana.mensaje });
            return;
          }
        }
        setEdit({
          tipo: prestamo.estado === 'En Curso' ? 'recibir' : 'entregar',
          id_prestamo: prestamo.id_prestamo,
          metodo: 'qr',
          prestamoDirecto: prestamo as PrestamoAdmin,
        });
      } catch (err) {
        if (!activo) return;
        setAvisoQr({
          tipo: 'error',
          texto: err instanceof Error ? err.message : 'No se encontró la reserva escaneada.',
        });
      } finally {
        onConsumirCodigoRetiro?.();
      }
    })();
    return () => {
      activo = false;
    };
  }, [codigoRetiroInicial, session, onConsumirCodigoRetiro]);

  useEffect(() => {
    const termino = dni.trim();
    if (omitirSiguienteSugerencia.current) {
      omitirSiguienteSugerencia.current = false;
      return;
    }
    if (termino.length < 2) {
      setUsuariosSugeridos([]);
      setMostrarSugerencias(false);
      setBuscandoUsuarios(false);
      return;
    }

    setMostrarSugerencias(true);
    setBuscandoUsuarios(true);
    const timer = window.setTimeout(async () => {
      const { data } = await supabase
        .from('usuarios')
        .select('id_usuario, dni, nombre, apellido, email, estado')
        .or(`dni.ilike.%${termino}%,nombre.ilike.%${termino}%,apellido.ilike.%${termino}%`)
        .limit(6);
      setUsuariosSugeridos((data ?? []) as Usuario[]);
      setBuscandoUsuarios(false);
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [dni]);

  useEffect(() => {
    const termino = quickDni.trim();
    if (!quickOpen || quickUser || termino.length < 2) {
      setQuickUsuariosSugeridos([]);
      setQuickMostrarSugerencias(false);
      setQuickBuscandoUsuarios(false);
      return;
    }

    setQuickMostrarSugerencias(true);
    setQuickBuscandoUsuarios(true);
    const timer = window.setTimeout(async () => {
      const { data } = await supabase
        .from('usuarios')
        .select('id_usuario, dni, nombre, apellido, email, estado, usuario_roles(roles(*))')
        .or(`dni.ilike.%${termino}%,nombre.ilike.%${termino}%,apellido.ilike.%${termino}%`)
        .limit(5);
      setQuickUsuariosSugeridos((data ?? []) as unknown as Usuario[]);
      setQuickBuscandoUsuarios(false);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [quickDni, quickOpen, quickUser]);

  useEffect(() => {
    const cerrarAlHacerClickFuera = (event: MouseEvent) => {
      if (buscadorRef.current && !buscadorRef.current.contains(event.target as Node)) {
        setMostrarSugerencias(false);
      }
    };
    document.addEventListener('mousedown', cerrarAlHacerClickFuera);
    return () => document.removeEventListener('mousedown', cerrarAlHacerClickFuera);
  }, []);

  useEffect(() => {
    const cerrarBuscadorRapidoAlHacerClickFuera = (event: MouseEvent) => {
      if (quickBuscadorRef.current && !quickBuscadorRef.current.contains(event.target as Node)) {
        setQuickMostrarSugerencias(false);
      }
    };
    document.addEventListener('mousedown', cerrarBuscadorRapidoAlHacerClickFuera);
    return () => document.removeEventListener('mousedown', cerrarBuscadorRapidoAlHacerClickFuera);
  }, []);

  const seleccionarUsuario = (seleccionado: Usuario) => {
    omitirSiguienteSugerencia.current = true;
    setDni(seleccionado.dni);
    setMostrarSugerencias(false);
    setUsuariosSugeridos([]);
    buscar(seleccionado.dni);
  };

  const seleccionarUsuarioRapido = (seleccionado: Usuario) => {
    setQuickDni(seleccionado.dni);
    setQuickMostrarSugerencias(false);
    setQuickUsuariosSugeridos([]);
    if (seleccionado.estado === 'Sancionado') {
      setQuickUser(null);
      setQuickError('Este usuario está sancionado y no puede retirar equipos');
      return;
    }
    setQuickError('');
    setQuickUser(seleccionado);
  };

  const opcionesFinMostrador = useMemo(() => {
    if (!quickHoraInicio) return [] as { value: string; label: string }[];
    const inicioMin = aMinutos(quickHoraInicio);
    const cierreHHMM = normalizarHHMM(configHorarios.hora_cierre_devolucion, '22:00');
    const cierreMin = aMinutos(cierreHHMM);
    if (inicioMin >= cierreMin) return [];

    const opciones: { value: string; label: string }[] = [];
    let incluyoCierre = false;
    for (const h of [1, 2, 3, 4, 5]) {
      const finMin = inicioMin + h * 60;
      if (finMin <= cierreMin) {
        const finStr = aHHMM(finMin);
        if (finMin === cierreMin) incluyoCierre = true;
        opciones.push({
          value: finStr,
          label: `${h} ${h === 1 ? 'hora' : 'horas'} (hasta ${finStr} hs)`,
        });
      }
    }
    if (!incluyoCierre) {
      opciones.push({
        value: cierreHHMM,
        label: `Hasta el cierre (${cierreHHMM} hs)`,
      });
    }
    return opciones;
  }, [quickHoraInicio, configHorarios.hora_cierre_devolucion]);

  const conflictoMostrador = useMemo(() => {
    return (idEquipo: string): ReservaBloqueHoy | null => {
      if (!quickHoraInicio || !quickHoraFin) return null;
      const lista = reservasHoyEquipo[idEquipo] ?? [];
      return (
        lista.find((r) => bloquesSeSolapan(quickHoraInicio, quickHoraFin, r.inicio, r.fin)) ?? null
      );
    };
  }, [reservasHoyEquipo, quickHoraInicio, quickHoraFin]);

  const categoriasMostrador = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const eq of equiposDisponibles) {
      const nombre = eq.categorias_equipo?.nombre;
      if (eq.id_categoria && nombre) mapa.set(eq.id_categoria, nombre);
    }
    return Array.from(mapa.entries())
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [equiposDisponibles]);

  const equiposMostradorVisibles = useMemo(() => {
    return equiposDisponibles
      .filter((eq) => quickCategoria === 'all' || eq.id_categoria === quickCategoria)
      .sort((a, b) => {
        const oa = a.oculto_catalogo ? 1 : 0;
        const ob = b.oculto_catalogo ? 1 : 0;
        if (oa !== ob) return oa - ob;
        const ca = conflictoMostrador(a.id_equipo) ? 1 : 0;
        const cb = conflictoMostrador(b.id_equipo) ? 1 : 0;
        if (ca !== cb) return ca - cb;
        return a.codigo_inventario.localeCompare(b.codigo_inventario);
      });
  }, [equiposDisponibles, quickCategoria, conflictoMostrador]);

  const equiposSeleccionadosConConflicto = useMemo(() => {
    return Object.keys(equiposSeleccionados)
      .map((id) => ({
        equipo: equiposDisponibles.find((e) => e.id_equipo === id),
        conflicto: conflictoMostrador(id),
      }))
      .filter(
        (item): item is { equipo: Equipo; conflicto: ReservaBloqueHoy } =>
          Boolean(item.equipo && item.conflicto),
      );
  }, [equiposSeleccionados, equiposDisponibles, conflictoMostrador]);

  const prepararPrestamoRapido = async () => {
    const ahora = new Date();
    const horaInicioActual = horaLocalHHMMSS(ahora).slice(0, 5);
    setQuickHoraInicio(horaInicioActual);
    setQuickDni('');
    setQuickUser(null);
    setQuickError('');
    setEquiposSeleccionados({});
    setQuickCategoria('all');
    setQuickObs('');
    setQuickOpen(true);

    const hoy = fechaLocalISO(ahora);
    const [cfg, { data }, { data: detsHoy }] = await Promise.all([
      cargarConfiguracionHorarios().catch(() => configHorarios),
      supabase
        .from('equipos')
        .select('*, categorias_equipo(*)')
        .eq('estado', 'Disponible')
        .order('codigo_inventario'),
      supabase
        .from('detalle_prestamos')
        .select('id_equipo, prestamos!inner(fecha_prestamo, hora_inicio_prevista, hora_fin_prevista, estado)')
        .eq('prestamos.fecha_prestamo', hoy)
        .in('prestamos.estado', ['Reservado', 'En Curso']),
    ]);
    setConfigHorarios(cfg);

    const inicioMin = aMinutos(horaInicioActual);
    const cierreHHMM = normalizarHHMM(cfg.hora_cierre_devolucion, '22:00');
    const cierreMin = aMinutos(cierreHHMM);
    if (inicioMin >= cierreMin) {
      setQuickHoraFin('');
    } else if (inicioMin + 60 <= cierreMin) {
      setQuickHoraFin(aHHMM(inicioMin + 60));
    } else {
      setQuickHoraFin(cierreHHMM);
    }

    setEquiposDisponibles((data ?? []) as Equipo[]);
    const mapaHoy: Record<string, ReservaBloqueHoy[]> = {};
    for (const d of (detsHoy ?? []) as any[]) {
      const p = Array.isArray(d.prestamos) ? d.prestamos[0] : d.prestamos;
      if (!p || p.fecha_prestamo !== hoy) continue;
      if (p.estado !== 'Reservado' && p.estado !== 'En Curso') continue;
      const bloque: ReservaBloqueHoy = {
        inicio: normalizarHHMM(p.hora_inicio_prevista),
        fin: normalizarHHMM(p.hora_fin_prevista),
      };
      mapaHoy[d.id_equipo] = [...(mapaHoy[d.id_equipo] ?? []), bloque];
    }
    setReservasHoyEquipo(mapaHoy);
  };

  const validarDniRapido = async () => {
    const documento = quickDni.trim();
    setQuickError('');
    setQuickUser(null);
    if (!documento) {
      setQuickError('Ingresá un DNI para continuar.');
      return;
    }
    setQuickValidating(true);
    const { data, error } = await supabase
      .from('usuarios')
      .select('id_usuario, dni, nombre, apellido, email, estado, usuario_roles(roles(*))')
      .eq('dni', documento)
      .maybeSingle();
    setQuickValidating(false);
    if (error || !data) {
      setQuickError('DNI no registrado');
      return;
    }
    const validado = data as unknown as Usuario;
    if (validado.estado === 'Sancionado') {
      setQuickError('Usuario sancionado');
      return;
    }
    setQuickUser(validado);
  };

  const crearPrestamoRapido = async () => {
    if (!quickUser) {
      setQuickError('Validá el DNI del solicitante antes de continuar.');
      return;
    }
    const equipos = Object.entries(equiposSeleccionados);
    if (equipos.length === 0) {
      setQuickError('Seleccioná al menos un equipo.');
      return;
    }
    const cierreHHMM = normalizarHHMM(configHorarios.hora_cierre_devolucion, '22:00');
    if (!quickHoraFin || aMinutos(quickHoraInicio) >= aMinutos(cierreHHMM)) {
      setQuickError(`El horario de cierre de hoy (${cierreHHMM} hs) ya pasó.`);
      return;
    }
    if (aMinutos(quickHoraFin) <= aMinutos(quickHoraInicio)) {
      setQuickError('La hora de devolución debe ser posterior a la hora de inicio.');
      return;
    }
    if (aMinutos(quickHoraFin) > aMinutos(cierreHHMM)) {
      setQuickError(`La hora de devolución no puede superar las ${cierreHHMM} hs.`);
      return;
    }
    if (equiposSeleccionadosConConflicto.length > 0) {
      setQuickError(
        `Quitá los equipos con conflicto horario o reducí la duración: ${equiposSeleccionadosConConflicto
          .map((c) => `${c.equipo.codigo_inventario} (${c.conflicto.inicio}–${c.conflicto.fin})`)
          .join(', ')}.`,
      );
      return;
    }

    setQuickSaving(true);
    setQuickError('');
    try {
      const { data: prestamo, error: prestamoError } = await supabase
        .from('prestamos')
        .insert({
          id_usuario: quickUser.id_usuario,
          fecha_prestamo: fechaLocalISO(),
          hora_inicio_prevista: `${quickHoraInicio}:00`,
          hora_fin_prevista: `${quickHoraFin}:00`,
          hora_retiro_real: new Date().toISOString(),
          estado: 'En Curso',
          observaciones_entrega: quickObs.trim() || null,
        })
        .select('id_prestamo')
        .single();
      if (prestamoError || !prestamo) throw new Error(prestamoError?.message ?? 'No se pudo crear el préstamo.');

      const { error: detalleError } = await supabase
        .from('detalle_prestamos')
        .insert(equipos.map(([idEquipo, estadoSalida]) => ({
          id_prestamo: prestamo.id_prestamo,
          id_equipo: idEquipo,
          estado_salida: estadoSalida.trim() || null,
        })));
      if (detalleError) {
        await supabase.from('prestamos').delete().eq('id_prestamo', prestamo.id_prestamo);
        throw new Error(detalleError.message || 'No se pudieron registrar los equipos del préstamo.');
      }

      const { error: equiposError } = await supabase
        .from('equipos')
        .update({ estado: 'En préstamo' })
        .in('id_equipo', equipos.map(([idEquipo]) => idEquipo));
      if (equiposError) throw new Error('No se pudo actualizar el estado de los equipos.');

      setQuickOpen(false);
      setFechaFiltro(fechaLocalISO());
      await Promise.all([
        cargarPrestamosPorFecha(fechaLocalISO()),
        cargarPrestamosEnCursoActivos(),
      ]);
    } catch (error) {
      setQuickError(error instanceof Error ? error.message : 'No se pudo crear el préstamo.');
    } finally {
      setQuickSaving(false);
    }
  };

  const openEdit = async (p: PrestamoAdmin, tipo: 'entregar' | 'recibir') => {
    if (tipo === 'entregar') {
      const noDisponibles = (p.detalle_prestamos ?? [])
        .map((d) => d.equipos)
        .filter((e): e is Equipo => Boolean(e))
        .filter((e) => e.estado === 'En préstamo' || e.estado === 'En mantenimiento' || e.estado === 'Baja');
      if (noDisponibles.length > 0) {
        setAvisoQr({
          tipo: 'error',
          texto: `No se puede entregar aún: ${noDisponibles
            .map((e) => `${e.codigo_inventario} (${e.estado})`)
            .join(', ')}.`,
        });
        return;
      }

      const cfg = await cargarConfiguracionHorarios().catch(() => ({ tolerancia_retiro_min: 5 }));
      const ventana = evaluarVentanaRetiro(p, cfg.tolerancia_retiro_min);
      if (ventana.estado !== 'sin_franja' && ventana.estado !== 'en_horario') {
        if (ventana.estado === 'vencido') {
          await verificarYCaducarReservasVencidas().catch(() => undefined);
          await cargarPrestamosPorFecha(fechaFiltro);
          if (dni.trim()) await buscar();
        }
        setAvisoQr({ tipo: 'error', texto: ventana.mensaje });
        return;
      }
    }
    setAvisoQr(null);
    setEdit({ tipo, id_prestamo: p.id_prestamo, metodo: 'manual', prestamoDirecto: p });
  };

  const guardar = async (resultado: ResultadoEntregaDevolucion) => {
    if (!edit) return;
    const p =
      edit.prestamoDirecto ??
      [...prestamos, ...prestamosFecha, ...prestamosEnCursoActivos].find(
        (x) => x.id_prestamo === edit.id_prestamo,
      );
    if (!p) {
      setEdit(null);
      setAvisoQr({
        tipo: 'error',
        texto: 'No se encontró el préstamo en memoria. Actualizá la lista e intentá nuevamente.',
      });
      return;
    }
    setBusy(p.id_prestamo);
    try {
      const detalles = p.detalle_prestamos ?? [];
      for (const e of resultado.equipos) {
        const { error: detErr } = await supabase
          .from('detalle_prestamos')
          .update(edit.tipo === 'entregar' ? { estado_salida: e.estado } : { estado_devolucion: e.estado })
          .eq('id_detalle', e.id_detalle);
        if (detErr) throw new Error(detErr.message);
      }

      if (edit.tipo === 'entregar') {
        const metodoEntrega = edit.metodo ?? 'manual';
        const { error: pErr } = await supabase
          .from('prestamos')
          .update({
            estado: 'En Curso',
            hora_retiro_real: new Date().toISOString(),
            observaciones_entrega: resultado.observaciones || null,
            metodo_entrega: metodoEntrega,
          })
          .eq('id_prestamo', p.id_prestamo);
        if (pErr) throw new Error(pErr.message);

        if (detalles.length > 0) {
          const { error: eqErr } = await supabase
            .from('equipos')
            .update({ estado: 'En préstamo' })
            .in(
              'id_equipo',
              detalles.map((d) => d.id_equipo),
            );
          if (eqErr) throw new Error(eqErr.message);
        }
        if (metodoEntrega === 'qr' || metodoEntrega === 'codigo') {
          setAvisoQr({
            tipo: 'exito',
            texto: `Entrega confirmada por ambas partes (${metodoEntrega === 'qr' ? 'QR' : 'Código'}) para ${p.usuarios?.nombre ?? 'el usuario'} ${p.usuarios?.apellido ?? ''}.`,
          });
        }
      } else {
        const metodoDevolucion = edit.metodo ?? 'manual';
        const { error: pErr } = await supabase
          .from('prestamos')
          .update({
            estado: 'Devuelto',
            hora_devolucion_real: new Date().toISOString(),
            observaciones_devolucion: resultado.observaciones || null,
            metodo_devolucion: metodoDevolucion,
          })
          .eq('id_prestamo', p.id_prestamo);
        if (pErr) throw new Error(pErr.message);

        if (metodoDevolucion === 'qr' || metodoDevolucion === 'codigo') {
          setAvisoQr({
            tipo: 'exito',
            texto: `Devolución confirmada por ambas partes (${metodoDevolucion === 'qr' ? 'QR' : 'Código'}) para ${p.usuarios?.nombre ?? 'el usuario'} ${p.usuarios?.apellido ?? ''}.`,
          });
        }
        const equiposConFallas = resultado.equipos.filter((e) => e.conDano);
        const equiposSinFallas = resultado.equipos.filter((e) => !e.conDano);

        if (equiposSinFallas.length > 0) {
          const { error: eqOkErr } = await supabase
            .from('equipos')
            .update({ estado: 'Disponible' })
            .in(
              'id_equipo',
              equiposSinFallas.map((e) => e.id_equipo),
            );
          if (eqOkErr) throw new Error(eqOkErr.message);
        }

        for (const e of equiposConFallas) {
          const observacionActual = detalles.find((d) => d.id_detalle === e.id_detalle)?.equipos?.observaciones?.trim();
          const observaciones = `${observacionActual ? `${observacionActual} | ` : ''}Daño en devolución: ${e.estado}`;

          const { error: eqErr } = await supabase
            .from('equipos')
            .update({ estado: 'En mantenimiento', observaciones })
            .eq('id_equipo', e.id_equipo);
          if (eqErr) throw new Error(eqErr.message);
        }
      }

      setEdit(null);
      await Promise.all([
        cargarPrestamosPorFecha(fechaFiltro),
        cargarPrestamosEnCursoActivos(),
      ]);
      if (dni.trim()) await buscar();
    } catch (err) {
      setAvisoQr({
        tipo: 'error',
        texto: err instanceof Error ? err.message : 'No se pudo registrar la operación.',
      });
    } finally {
      setBusy(null);
    }
  };

  const fechaHoy = fechaLocalISO(ahoraTick);
  const esHoy = fechaFiltro === fechaHoy;
  const tituloOperativo = esHoy ? 'Préstamos de hoy' : `Préstamos del ${formatoFecha(fechaFiltro)}`;

  const prestamosVencidos = useMemo(() => {
    return prestamosEnCursoActivos
      .map((p) => ({
        prestamo: p,
        vencimiento: evaluarVencimientoPrestamoEnCurso(p, configHorarios, ahoraTick),
      }))
      .filter((x) => x.vencimiento.vencido);
  }, [prestamosEnCursoActivos, configHorarios, ahoraTick]);

  const equiposEnUsoAhora = useMemo(
    () => prestamosEnCursoActivos.reduce((acc, p) => acc + (p.detalle_prestamos?.length ?? 0), 0),
    [prestamosEnCursoActivos],
  );

  const conteosPrestamos = {
    todos: prestamosFecha.length,
    Reservado: prestamosFecha.filter((p) => p.estado === 'Reservado').length,
    'En Curso': prestamosFecha.filter((p) => p.estado === 'En Curso').length,
    Devuelto: prestamosFecha.filter((p) => p.estado === 'Devuelto').length,
  };
  const prestamosVisibles =
    filtroPrestamos === 'todos'
      ? prestamosFecha
      : prestamosFecha.filter((p) => p.estado === filtroPrestamos);
  const mensajeFiltroVacio: Record<FiltroPrestamos, string> = {
    todos: `No hay préstamos ni reservas para el ${formatoFecha(fechaFiltro)}.`,
    Reservado: 'No hay reservas pendientes de entrega.',
    'En Curso': 'No hay equipos en uso en este momento.',
    Devuelto: 'No hay préstamos devueltos para esta fecha.',
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Panel de Administrador</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Escaneá el QR del usuario, buscá por DNI y gestioná entregas y devoluciones.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => {
              setAvisoQr(null);
              setScanOpen(true);
            }}
            className="btn-primary shrink-0"
          >
            <QrCode size={16} /> Escanear QR / Código
          </button>
          <button type="button" onClick={prepararPrestamoRapido} className="btn-secondary shrink-0">
            <PlusCircle size={16} /> Préstamo en mostrador
          </button>
        </div>
      </div>

      {avisoQr && (
        <div
          role="status"
          className={`mb-5 flex items-start justify-between gap-3 rounded-xl border p-4 text-sm ${
            avisoQr.tipo === 'error'
              ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200'
              : 'border-green-200 bg-green-50 text-green-800 dark:border-green-900/60 dark:bg-green-950/40 dark:text-green-200'
          }`}
        >
          <p className="flex items-start gap-2">
            <ShieldCheck size={16} className="mt-0.5 shrink-0" />
            <span>{avisoQr.texto}</span>
          </p>
          <button
            type="button"
            onClick={() => setAvisoQr(null)}
            className="btn-ghost h-8 w-8 shrink-0 !px-0"
            aria-label="Cerrar aviso"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {reservasCaducadas > 0 && (
        <div
          role="status"
          className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <p className="flex items-start gap-2">
            <PackageX size={16} className="mt-0.5 shrink-0" />
            {reservasCaducadas === 1
              ? '1 reserva vencida se canceló automáticamente como No Presentado y su equipo volvió a estar disponible.'
              : `${reservasCaducadas} reservas vencidas se cancelaron automáticamente como No Presentado y sus equipos volvieron a estar disponibles.`}
          </p>
          <button
            type="button"
            onClick={() => setReservasCaducadas(0)}
            className="btn-ghost h-8 w-8 shrink-0 !px-0"
            aria-label="Cerrar aviso"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {prestamosVencidos.length > 0 && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-100"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
              <div>
                <p className="font-semibold">
                  {prestamosVencidos.length === 1
                    ? '1 préstamo vencido sin devolver'
                    : `${prestamosVencidos.length} préstamos vencidos sin devolver`}
                </p>
                <p className="text-xs text-red-700 dark:text-red-300">
                  Cierre configurado: {configHorarios.hora_cierre_devolucion} hs · Tolerancia:{' '}
                  {configHorarios.tolerancia_retiro_min} min
                </p>
              </div>
            </div>
          </div>

          <ul className="mt-3 space-y-2">
            {prestamosVencidos.map(({ prestamo, vencimiento }) => {
              const codigos = (prestamo.detalle_prestamos ?? [])
                .map((d) => d.equipos?.codigo_inventario)
                .filter(Boolean)
                .join(', ');
              return (
                <li
                  key={prestamo.id_prestamo}
                  className="flex flex-col gap-2 rounded-lg border border-red-200 bg-white/80 p-3 dark:border-red-900/50 dark:bg-gray-950/60 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {prestamo.usuarios
                          ? `${prestamo.usuarios.nombre} ${prestamo.usuarios.apellido} · DNI ${prestamo.usuarios.dni}`
                          : 'Usuario sin datos'}
                      </span>
                      <Badge variant="red">
                        <Clock size={11} /> {vencimiento.etiqueta}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">
                      Equipos: <span className="font-medium">{codigos || '—'}</span> · Límite previsto:{' '}
                      {prestamo.hora_fin_prevista.slice(0, 5)} hs
                      {vencimiento.deFechaAnterior ? ` (${formatoFecha(prestamo.fecha_prestamo)})` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy === prestamo.id_prestamo}
                    onClick={() => openEdit(prestamo, 'recibir')}
                    className="btn-danger shrink-0 py-1.5 text-xs"
                  >
                    <PackageX size={14} /> Recibir devolución
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Buscador por DNI */}
      <div className="card mb-5 p-4">
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          Buscar usuario por DNI
        </label>
        <div className="flex gap-2">
          <div ref={buscadorRef} className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-gray-400" />
            <input
              className="input pl-9"
              placeholder="Ej: 34000001"
              inputMode="numeric"
              value={dni}
              onChange={(e) => setDni(e.target.value)}
              onFocus={() => dni.trim().length >= 2 && setMostrarSugerencias(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') buscar();
                if (e.key === 'Escape') setMostrarSugerencias(false);
              }}
            />
            {mostrarSugerencias && (
              <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                {buscandoUsuarios ? (
                  <p className="px-4 py-3 text-sm text-gray-500">Buscando…</p>
                ) : usuariosSugeridos.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-gray-500">No se encontraron usuarios</p>
                ) : (
                  <ul>
                    {usuariosSugeridos.map((usuarioSugerido) => (
                      <li key={usuarioSugerido.id_usuario}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => seleccionarUsuario(usuarioSugerido)}
                          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-gray-900 dark:text-white">
                              {usuarioSugerido.nombre} {usuarioSugerido.apellido}
                            </span>
                            <span className="block truncate text-xs text-gray-500">
                              DNI {usuarioSugerido.dni} · {usuarioSugerido.email}
                            </span>
                          </span>
                          <Badge variant={estadoUsuarioVariant(usuarioSugerido.estado)}>{usuarioSugerido.estado}</Badge>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <button type="button" onClick={() => buscar()} className="btn-primary">
            <Search size={16} /> Buscar
          </button>
        </div>
        {notFound && (
          <p className="mt-2 text-sm text-red-600">No se encontró ningún usuario con ese DNI.</p>
        )}
      </div>

      {/* Usuario encontrado */}
      {usuario && (
        <div className="card mb-5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
                <Users size={18} />
              </div>
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {usuario.nombre} {usuario.apellido}
                </p>
                <p className="text-xs text-gray-500">
                  DNI {usuario.dni} · {usuario.email}
                </p>
              </div>
            </div>
            <Badge variant={estadoUsuarioVariant(usuario.estado)}>{usuario.estado}</Badge>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {((usuario as any).usuario_roles ?? [])
              .map((r: any) => r.roles?.nombre)
              .filter(Boolean)
              .map((r: string) => (
                <Badge key={r} variant="blue">
                  {r}
                </Badge>
              ))}
          </div>
        </div>
      )}

      {/* Sección: préstamos del usuario */}
      {usuario && prestamos.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
            <ClipboardList size={16} className="text-brand-600" /> Préstamos del usuario
          </h2>
          <div className="space-y-3">
            {prestamos.map((p) => (
              <PrestamoCard
                key={p.id_prestamo}
                p={p}
                busy={busy === p.id_prestamo}
                vencimiento={
                  p.estado === 'En Curso'
                    ? evaluarVencimientoPrestamoEnCurso(p, configHorarios, ahoraTick)
                    : undefined
                }
                onEntregar={(p2) => openEdit(p2, 'entregar')}
                onRecibir={(p2) => openEdit(p2, 'recibir')}
                onCambiarEquipo={(p2) => setSwapPrestamo(p2)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Préstamos operativos por fecha */}
      <div>
        <div className="mb-3 flex flex-col gap-3 rounded-lg bg-gray-100 px-4 py-3 dark:bg-gray-800 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setShowSelectedDate((s) => !s)}
              className="flex items-center gap-2 text-left text-sm font-semibold text-gray-800 dark:text-gray-100"
            >
              <PackageCheck size={16} className="text-brand-600" />
              <span>{tituloOperativo} · {prestamosFecha.length}</span>
              <span className="ml-1 text-xs font-normal text-gray-500">
                {showSelectedDate ? 'Ocultar' : 'Mostrar'}
              </span>
            </button>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              En uso ahora en todo el pañol:{' '}
              <span className="font-semibold text-gray-700 dark:text-gray-200">
                {prestamosEnCursoActivos.length} préstamo{prestamosEnCursoActivos.length === 1 ? '' : 's'} (
                {equiposEnUsoAhora} equipo{equiposEnUsoAhora === 1 ? '' : 's'})
              </span>
              {prestamosVencidos.length > 0 && (
                <span className="ml-1.5 font-semibold text-red-600 dark:text-red-400">
                  · {prestamosVencidos.length} vencido{prestamosVencidos.length === 1 ? '' : 's'}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-col gap-1.5 sm:w-64">
            <div className="flex flex-nowrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setFechaFiltro(sumarDias(fechaFiltro, -1))}
                className="btn-secondary h-9 w-9 shrink-0 border border-gray-200 bg-white !px-0 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
                aria-label="Día anterior"
              >
                <ChevronLeft size={17} />
              </button>
              <input
                type="date"
                className="input h-9 min-w-0 flex-1 text-center"
                value={fechaFiltro}
                onChange={(e) => setFechaFiltro(e.target.value)}
                aria-label="Seleccionar fecha"
              />
              <button
                type="button"
                onClick={() => setFechaFiltro(sumarDias(fechaFiltro, 1))}
                className="btn-secondary h-9 w-9 shrink-0 border border-gray-200 bg-white !px-0 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
                aria-label="Día siguiente"
              >
                <ChevronRight size={17} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setFechaFiltro(fechaHoy)}
              className={`btn h-8 w-full text-xs ${
                esHoy
                  ? 'bg-brand-600 text-white shadow-sm hover:bg-brand-700'
                  : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
              }`}
            >
              Hoy
            </button>
          </div>
        </div>

        {showSelectedDate && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-950">
              {([
                { id: 'todos' as const, label: 'Todos', icon: ClipboardList },
                { id: 'Reservado' as const, label: 'Por entregar', icon: PackageCheck },
                { id: 'En Curso' as const, label: 'En uso', icon: Clock },
                { id: 'Devuelto' as const, label: 'Devueltos', icon: Calendar },
              ]).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFiltroPrestamos(id)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    filtroPrestamos === id
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  <Icon size={15} />
                  <span>{label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${
                    filtroPrestamos === id ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                  }`}>{conteosPrestamos[id]}</span>
                </button>
              ))}
            </div>
            {loading ? (
              <div className="card flex items-center justify-center gap-2 px-6 py-10 text-sm text-gray-500">
                <Calendar size={16} className="animate-pulse text-brand-600" />
                Cargando préstamos del {formatoFecha(fechaFiltro)}…
              </div>
            ) : prestamosVisibles.length === 0 ? (
              <div className="card px-6 py-10 text-center text-sm text-gray-500">
                {mensajeFiltroVacio[filtroPrestamos]}
              </div>
            ) : (
              prestamosVisibles.map((p) => (
                <PrestamoCard
                  key={p.id_prestamo}
                  p={p}
                  busy={busy === p.id_prestamo}
                  vencimiento={
                    p.estado === 'En Curso'
                      ? evaluarVencimientoPrestamoEnCurso(p, configHorarios, ahoraTick)
                      : undefined
                  }
                  onEntregar={(p2) => openEdit(p2, 'entregar')}
                  onRecibir={(p2) => openEdit(p2, 'recibir')}
                  onCambiarEquipo={(p2) => setSwapPrestamo(p2)}
                  showUser
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Modal de préstamo rápido */}
      {quickOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-card dark:bg-gray-950 sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Préstamo en mostrador</h2>
                <p className="text-xs text-gray-500">Validá al solicitante y entregá los equipos en el momento.</p>
              </div>
              <button type="button" onClick={() => setQuickOpen(false)} className="btn-ghost h-9 w-9 !px-0">
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="mb-5">
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Solicitante</label>
                <div ref={quickBuscadorRef} className="relative">
                  <input
                    className="input"
                    value={quickDni}
                    onChange={(e) => {
                      setQuickDni(e.target.value);
                      setQuickUser(null);
                      setQuickError('');
                    }}
                    onFocus={() => quickDni.trim().length >= 2 && !quickUser && setQuickMostrarSugerencias(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') validarDniRapido();
                      if (e.key === 'Escape') setQuickMostrarSugerencias(false);
                    }}
                    placeholder="Buscar por DNI, nombre o apellido..."
                  />
                  {quickMostrarSugerencias && (
                    <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                      {quickBuscandoUsuarios ? (
                        <p className="px-4 py-3 text-sm text-gray-500">Buscando…</p>
                      ) : quickUsuariosSugeridos.length === 0 ? (
                        <p className="px-4 py-3 text-sm text-gray-500">No se encontraron usuarios</p>
                      ) : (
                        <ul>
                          {quickUsuariosSugeridos.map((usuarioSugerido) => (
                            <li key={usuarioSugerido.id_usuario}>
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => seleccionarUsuarioRapido(usuarioSugerido)}
                                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-semibold text-gray-900 dark:text-white">
                                    {usuarioSugerido.nombre} {usuarioSugerido.apellido}
                                  </span>
                                  <span className="block truncate text-xs text-gray-500">
                                    DNI {usuarioSugerido.dni} · {usuarioSugerido.email}
                                  </span>
                                </span>
                                <Badge variant={estadoUsuarioVariant(usuarioSugerido.estado)}>{usuarioSugerido.estado}</Badge>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
                {quickUser && (
                  <div className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-900 dark:bg-green-950/20">
                    <div>
                      <p className="font-medium text-green-800 dark:text-green-300">
                        {quickUser.nombre} {quickUser.apellido}
                      </p>
                      <p className="text-xs text-green-700 dark:text-green-400">
                        DNI {quickUser.dni} · {((quickUser as any).usuario_roles ?? []).map((r: any) => r.roles?.nombre).filter(Boolean).join(', ') || 'Sin rol asignado'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setQuickUser(null);
                        setQuickDni('');
                        setQuickError('');
                      }}
                      className="btn-ghost h-8 w-8 !px-0"
                      aria-label="Cambiar usuario"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
                {quickError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{quickError}</p>}
              </div>

              <div className="mb-5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Equipos disponibles
                  </label>
                  <div className="flex items-center gap-2">
                    <select
                      className="input h-8 w-auto text-xs"
                      value={quickCategoria}
                      onChange={(e) => setQuickCategoria(e.target.value)}
                      aria-label="Filtrar equipos por categoría"
                    >
                      <option value="all">Todas las categorías</option>
                      {categoriasMostrador.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nombre}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-gray-500">
                      {Object.keys(equiposSeleccionados).length} selec.
                    </span>
                  </div>
                </div>
                {equiposSeleccionadosConConflicto.length > 0 && (
                  <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                    El bloque elegido ({quickHoraInicio}–{quickHoraFin} hs) se superpone con reservas de hoy:{' '}
                    {equiposSeleccionadosConConflicto
                      .map((c) => `${c.equipo.codigo_inventario} (${c.conflicto.inicio}–${c.conflicto.fin})`)
                      .join(', ')}
                    . Destildalos o reducí la duración.
                  </div>
                )}
                {equiposMostradorVisibles.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-700">
                    No hay equipos disponibles en esta categoría.
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {equiposMostradorVisibles.map((equipo) => {
                      const seleccionado = Object.prototype.hasOwnProperty.call(equiposSeleccionados, equipo.id_equipo);
                      const conflicto = conflictoMostrador(equipo.id_equipo);
                      const otrasReservas = (reservasHoyEquipo[equipo.id_equipo] ?? []).filter(
                        (r) => r !== conflicto,
                      );
                      const deshabilitado = Boolean(conflicto) && !seleccionado;
                      return (
                        <div
                          key={equipo.id_equipo}
                          className={`rounded-lg border p-3 transition-colors ${
                            conflicto
                              ? 'border-red-200 bg-red-50/40 opacity-75 dark:border-red-900/50 dark:bg-red-950/20'
                              : seleccionado
                                ? 'border-brand-300 bg-brand-50/50 dark:border-brand-800 dark:bg-brand-950/20'
                                : 'border-gray-200 dark:border-gray-800'
                          }`}
                        >
                          <label className={`flex items-start gap-3 ${deshabilitado ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                            <input
                              type="checkbox"
                              checked={seleccionado}
                              disabled={deshabilitado}
                              onChange={(e) => {
                                setEquiposSeleccionados((actuales) => {
                                  const siguiente = { ...actuales };
                                  if (e.target.checked) siguiente[equipo.id_equipo] = 'Buen estado';
                                  else delete siguiente[equipo.id_equipo];
                                  return siguiente;
                                });
                              }}
                              className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-white">
                                {equipo.codigo_inventario}
                                {equipo.oculto_catalogo && <Badge variant="gray">Oculto</Badge>}
                              </span>
                              <span className="block text-xs text-gray-500">
                                {equipo.categorias_equipo?.nombre} · {equipo.marca_modelo ?? '—'}
                                {equipo.oculto_catalogo && equipo.observaciones ? ` · ${equipo.observaciones}` : ''}
                              </span>
                              {conflicto ? (
                                <span className="mt-0.5 block text-[11px] font-medium text-red-600 dark:text-red-400">
                                  Ocupado {conflicto.inicio}–{conflicto.fin} hs
                                </span>
                              ) : otrasReservas.length > 0 ? (
                                <span className="mt-0.5 block text-[11px] font-medium text-amber-700 dark:text-amber-300">
                                  Reserva hoy: {otrasReservas.map((r) => `${r.inicio}–${r.fin}`).join(', ')}
                                </span>
                              ) : null}
                            </span>
                          </label>
                          {seleccionado && (
                            <input
                              className="input mt-2 text-sm"
                              value={equiposSeleccionados[equipo.id_equipo]}
                              onChange={(e) => setEquiposSeleccionados((actuales) => ({ ...actuales, [equipo.id_equipo]: e.target.value }))}
                              placeholder="Estado de salida"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mb-5 grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">Fecha</label>
                  <input className="input" type="date" value={fechaHoy} readOnly />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">Hora de inicio</label>
                  <input className="input" type="time" value={quickHoraInicio} readOnly />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">
                    Devolución (cierre {normalizarHHMM(configHorarios.hora_cierre_devolucion, '22:00')} hs)
                  </label>
                  <select
                    className="input"
                    value={quickHoraFin}
                    disabled={opcionesFinMostrador.length === 0}
                    onChange={(e) => setQuickHoraFin(e.target.value)}
                  >
                    {opcionesFinMostrador.length === 0 ? (
                      <option value="">Fuera de horario de cierre</option>
                    ) : (
                      opcionesFinMostrador.map((op) => (
                        <option key={op.value} value={op.value}>
                          {op.label}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              {opcionesFinMostrador.length === 0 && (
                <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                  Ya pasó la hora de cierre configurada ({normalizarHHMM(configHorarios.hora_cierre_devolucion, '22:00')} hs). No se pueden iniciar nuevos préstamos en mostrador hoy.
                </p>
              )}

              <label className="mb-1 block text-xs font-medium text-gray-500">Observaciones de entrega</label>
              <textarea
                className="input min-h-20"
                value={quickObs}
                onChange={(e) => setQuickObs(e.target.value)}
                placeholder="Notas del préstamo en mostrador…"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
              <button type="button" onClick={() => setQuickOpen(false)} className="btn-ghost">Cancelar</button>
              <button
                type="button"
                onClick={crearPrestamoRapido}
                disabled={quickSaving || opcionesFinMostrador.length === 0 || equiposSeleccionadosConConflicto.length > 0}
                className="btn-primary"
              >
                {quickSaving ? 'Creando…' : 'Confirmar y entregar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Escáner de QR / Código de retiro o devolución */}
      {scanOpen && (
        <EscanearRetiroModal
          onCerrar={() => setScanOpen(false)}
          onEncontrado={(prestamo, metodo) => {
            setScanOpen(false);
            setEdit({
              tipo: prestamo.estado === 'En Curso' ? 'recibir' : 'entregar',
              id_prestamo: prestamo.id_prestamo,
              metodo,
              prestamoDirecto: prestamo as PrestamoAdmin,
            });
          }}
        />
      )}

      {/* Botón flotante móvil exclusivo del administrador para abrir el escáner */}
      {!scanOpen && !edit && !quickOpen && !swapPrestamo && (
        <button
          type="button"
          onClick={() => {
            setAvisoQr(null);
            setScanOpen(true);
          }}
          aria-label="Escanear QR o código"
          title="Escanear QR o código"
          className="fixed bottom-5 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg transition hover:bg-brand-700 active:scale-95 md:hidden"
        >
          <QrCode size={24} />
        </button>
      )}

      {/* Modal de cambio rápido de equipo en préstamo En Curso */}
      {swapPrestamo && (
        <CambiarEquipoModal
          idPrestamo={swapPrestamo.id_prestamo}
          nombreUsuario={
            `${swapPrestamo.usuarios?.nombre ?? usuario?.nombre ?? ''} ${swapPrestamo.usuarios?.apellido ?? usuario?.apellido ?? ''}`.trim() ||
            'el usuario'
          }
          fechaPrestamo={swapPrestamo.fecha_prestamo}
          horaInicioPrevista={swapPrestamo.hora_inicio_prevista}
          horaFinPrevista={swapPrestamo.hora_fin_prevista}
          detalles={swapPrestamo.detalle_prestamos ?? []}
          onCerrar={() => setSwapPrestamo(null)}
          onCambiado={(mensaje) => {
            setSwapPrestamo(null);
            setAvisoQr({ tipo: 'exito', texto: mensaje });
            void cargarPrestamosPorFecha(fechaFiltro);
            void cargarPrestamosEnCursoActivos();
            if (dni.trim()) void buscar();
          }}
        />
      )}

      {/* Modal de entrega / recepción */}
      {edit && (() => {
        const p =
          edit.prestamoDirecto ??
          [...prestamos, ...prestamosFecha, ...prestamosEnCursoActivos].find(
            (x) => x.id_prestamo === edit.id_prestamo,
          );
        if (!p) return null;
        const accionTexto = edit.tipo === 'entregar' ? 'Entrega para' : 'Devolución de';
        const contextoModal = p.usuarios
          ? `${accionTexto} ${p.usuarios.nombre} ${p.usuarios.apellido} · DNI ${p.usuarios.dni}${
              edit.metodo === 'qr'
                ? ' · Verificado con QR'
                : edit.metodo === 'codigo'
                  ? ` · Verificado con código ${p.codigo_retiro ?? ''}`
                  : ''
            }`
          : undefined;
        return (
          <EntregaDevolucionModal
            tipo={edit.tipo}
            detalles={p.detalle_prestamos ?? []}
            observacionesIniciales={(edit.tipo === 'entregar' ? p.observaciones_entrega : p.observaciones_devolucion) ?? ''}
            contexto={contextoModal}
            guardando={busy === p.id_prestamo}
            onCancelar={() => setEdit(null)}
            onConfirmar={guardar}
          />
        );
      })()}
    </div>
  );
}

function PrestamoCard({
  p,
  busy,
  vencimiento,
  onEntregar,
  onRecibir,
  onCambiarEquipo,
  showUser = false,
}: {
  p: PrestamoAdmin;
  busy: boolean;
  vencimiento?: EstadoVencimientoPrestamo;
  onEntregar: (p: PrestamoAdmin) => void;
  onRecibir: (p: PrestamoAdmin) => void;
  onCambiarEquipo: (p: PrestamoAdmin) => void;
  showUser?: boolean;
}) {
  const fecha = useMemo(
    () => new Date(p.fecha_prestamo + 'T00:00:00').toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }),
    [p.fecha_prestamo],
  );

  const estaVencido = p.estado === 'En Curso' && Boolean(vencimiento?.vencido);
  const estilosEstado: Record<string, string> = {
    Reservado: 'border-l-4 border-amber-500 bg-amber-50/30 dark:bg-amber-950/10',
    'En Curso': 'border-l-4 border-blue-600 bg-blue-50/30 dark:bg-blue-950/10',
    Devuelto: 'border-l-4 border-emerald-500 opacity-80',
    Cancelado: 'border-l-4 border-gray-400 opacity-60',
    'No Presentado': 'border-l-4 border-red-400 bg-red-50/20 dark:bg-red-950/10 opacity-85',
  };
  const estiloEstado = estaVencido
    ? 'border-l-4 border-red-600 bg-red-50/40 dark:bg-red-950/20'
    : (estilosEstado[p.estado] ?? 'border-l-4 border-gray-300');

  const confirmacionEntrega = etiquetaMetodoEntrega(p.metodo_entrega);
  const confirmacionDevolucion = etiquetaMetodoDevolucion(p.metodo_devolucion);

  return (
    <div className={`card p-4 ${estiloEstado}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={estadoPrestamoVariant(p.estado)}>{p.estado}</Badge>
            {estaVencido && vencimiento && (
              <Badge variant="red">
                <Clock size={12} /> {vencimiento.etiqueta}
              </Badge>
            )}
            {confirmacionEntrega && (
              <Badge variant="green">
                <ShieldCheck size={12} /> {confirmacionEntrega}
              </Badge>
            )}
            {confirmacionDevolucion && (
              <Badge variant="green">
                <ShieldCheck size={12} /> {confirmacionDevolucion}
              </Badge>
            )}
            <span className="text-xs text-gray-500">
              {fecha} · {p.estado === 'En Curso'
                ? `Retiro ${formatoHora(p.hora_retiro_real)} · Límite ${p.hora_fin_prevista.slice(0, 5)}`
                : p.estado === 'Devuelto'
                  ? `Devuelto ${formatoHora(p.hora_devolucion_real)}`
                  : p.retiro_desde && p.retiro_hasta
                    ? `Retiro ${p.retiro_desde.slice(0, 5)}–${p.retiro_hasta.slice(0, 5)} · Dev. ${p.hora_fin_prevista.slice(0, 5)}`
                    : `Inicio ${p.hora_inicio_prevista.slice(0, 5)} · Fin ${p.hora_fin_prevista.slice(0, 5)}`}
            </span>
          </div>
          {showUser && p.usuarios && (
            <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
              {p.usuarios.nombre} {p.usuarios.apellido} · DNI {p.usuarios.dni}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {p.estado === 'Reservado' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onEntregar(p)}
              className="btn-primary"
            >
              <PackageCheck size={15} /> Entregar
            </button>
          )}
          {p.estado === 'En Curso' && (
            <>
              {p.detalle_prestamos && p.detalle_prestamos.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onCambiarEquipo(p)}
                  className="btn-secondary"
                >
                  <ArrowLeftRight size={15} /> Cambiar equipo
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => onRecibir(p)}
                className="btn-secondary"
              >
                <PackageX size={15} /> Recibir devolución
              </button>
            </>
          )}
        </div>
      </div>
      {p.detalle_prestamos && p.detalle_prestamos.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3 dark:border-gray-800">
          <ul className="grid gap-2 sm:grid-cols-2">
            {p.detalle_prestamos.map((d) => (
              <li key={d.id_detalle} className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-800">
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {d.equipos?.codigo_inventario}
                </p>
                <p className="text-xs text-gray-500">
                  {d.equipos?.categorias_equipo?.nombre} · {d.equipos?.marca_modelo ?? '—'}
                </p>
                {d.estado_salida && (
                  <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">Salida: {d.estado_salida}</p>
                )}
                {d.estado_devolucion && (
                  <p className="text-xs text-gray-600 dark:text-gray-400">Devolución: {d.estado_devolucion}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
