import { useEffect, useMemo, useState } from 'react';
import { X, Calendar, Clock, ShoppingCart, Trash2, PlusCircle, AlertCircle } from 'lucide-react';
import { supabase } from '@/services/supabaseClient';
import type { Equipo, ConfiguracionHorarios, FranjaRetiro } from '@/types/database';
import { useAuth } from '@/context/AuthContext';
import Badge, { estadoEquipoVariant } from '@/components/ui/Badge';
import {
  aplicaLimitesReserva,
  cargarCuposEstudiante,
  cupoDeEquipo,
  mensajeLimiteCategoria,
  type CupoCategoria,
} from '@/features/prestamos/services/prestamosService';
import {
  CONFIGURACION_HORARIOS_DEFECTO,
  aMinutos,
  bloquesSeSolapan,
  cargarConfiguracionHorarios,
  esFinDeSemanaISO,
  franjaYaCerroHoy,
  franjasDisponiblesHastaCierre,
  horasInicioLibresHastaCierre,
  siguienteDiaHabilISO,
  sumarDiasISO,
  sumarMinutosHHMM,
} from '@/features/configuracion/services/horariosService';
import { fechaLocalISO, horaLocalHHMMSS } from '@/utils/fechas';

type ReservaAgenda = {
  id_prestamo: string;
  id_equipo: string;
  fecha_prestamo: string;
  hora_inicio_prevista: string;
  hora_fin_prevista: string;
  estado: string;
};

function pad(n: number) {
  return n.toString().padStart(2, '0');
}

function formatearFechaCorta(fechaISO: string): string {
  if (!fechaISO) return '';
  return new Date(`${fechaISO}T12:00:00`).toLocaleDateString('es-AR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
}

function sugerirDevolucion(horaInicioHHMM: string, cfg: ConfiguracionHorarios): string {
  const cierreMin = aMinutos(cfg.hora_cierre_devolucion);
  const mas80 = sumarMinutosHHMM(horaInicioHHMM, 80);
  if (aMinutos(mas80) <= cierreMin && aMinutos(mas80) > aMinutos(horaInicioHHMM)) {
    return mas80;
  }
  return cfg.hora_cierre_devolucion;
}

function estadoInicialConConfig(cfg: ConfiguracionHorarios, preferirDiaSiguiente = false) {
  const ahora = new Date();
  const hoy = fechaLocalISO(ahora);
  const fechaMax = sumarDiasISO(hoy, cfg.dias_anticipacion_max);
  const manana = sumarDiasISO(hoy, 1);
  const diaSiguienteHabil =
    cfg.dias_anticipacion_max >= 1
      ? siguienteDiaHabilISO(manana, fechaMax, cfg.permitir_fines_de_semana)
      : hoy;
  const hoyPermitido =
    !preferirDiaSiguiente && (cfg.permitir_fines_de_semana || !esFinDeSemanaISO(hoy));

  const franjasValidas = franjasDisponiblesHastaCierre(cfg.franjas, cfg.hora_cierre_devolucion);

  if (cfg.franjas_activas && franjasValidas.length > 0) {
    if (hoyPermitido) {
      const abiertaHoy = franjasValidas.find((f) => !franjaYaCerroHoy(f, cfg.tolerancia_retiro_min));
      if (abiertaHoy) {
        return {
          fecha: hoy,
          franjaId: abiertaHoy.id,
          horaInicioLibre: abiertaHoy.hora_clase,
          horaDevolucion: sugerirDevolucion(abiertaHoy.hora_clase, cfg),
        };
      }
    }
    const primera = franjasValidas[0];
    return {
      fecha: diaSiguienteHabil,
      franjaId: primera.id,
      horaInicioLibre: primera.hora_clase,
      horaDevolucion: sugerirDevolucion(primera.hora_clase, cfg),
    };
  }

  const horasValidas = horasInicioLibresHastaCierre(cfg.hora_cierre_devolucion);
  const horaActual = ahora.getHours();
  if (hoyPermitido) {
    const siguienteHoy = horasValidas.find((h) => h > horaActual);
    if (siguienteHoy !== undefined) {
      const hStr = `${pad(siguienteHoy)}:00`;
      return {
        fecha: hoy,
        franjaId: '',
        horaInicioLibre: hStr,
        horaDevolucion: sugerirDevolucion(hStr, cfg),
      };
    }
  }
  const primeraHora = `${pad(horasValidas[0] ?? 8)}:00`;
  return {
    fecha: diaSiguienteHabil,
    franjaId: '',
    horaInicioLibre: primeraHora,
    horaDevolucion: sugerirDevolucion(primeraHora, cfg),
  };
}

export default function ReserveModal({
  initialEquipo,
  onClose,
  onDone,
}: {
  initialEquipo?: Equipo | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { session } = useAuth();
  const [configHorarios, setConfigHorarios] = useState<ConfiguracionHorarios>(CONFIGURACION_HORARIOS_DEFECTO);
  const [cart, setCart] = useState<Equipo[]>(initialEquipo ? [initialEquipo] : []);
  const [equipos, setEquipos] = useState<Equipo[]>([]);
  const [agenda, setAgenda] = useState<ReservaAgenda[]>([]);
  const [q, setQ] = useState('');
  const [fecha, setFecha] = useState(() => fechaLocalISO());
  const [franjaId, setFranjaId] = useState<string>(CONFIGURACION_HORARIOS_DEFECTO.franjas[0].id);
  const [horaInicioLibre, setHoraInicioLibre] = useState('08:00');
  const [horaDevolucion, setHoraDevolucion] = useState('09:20');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cupos, setCupos] = useState<CupoCategoria[]>([]);

  const idUsuario = session?.usuario.id_usuario;
  const limitado = !!session && aplicaLimitesReserva(session.roles);
  const preferirMananaInicial = initialEquipo?.estado === 'En préstamo';

  useEffect(() => {
    if (!idUsuario || !limitado) return;
    let active = true;
    cargarCuposEstudiante(idUsuario)
      .then((c) => {
        if (active) setCupos(c);
      })
      .catch(() => {
        if (active) setError('No se pudo verificar tu cupo de equipos. Intentá nuevamente.');
      });
    return () => {
      active = false;
    };
  }, [idUsuario, limitado]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [{ data: e }, { data: dets }, cfg] = await Promise.all([
        supabase
          .from('equipos')
          .select('*, categorias_equipo(*)')
          .neq('oculto_catalogo', true)
          .in('estado', ['Disponible', 'Reservado', 'En préstamo'])
          .order('codigo_inventario'),
        supabase
          .from('detalle_prestamos')
          .select('id_prestamo, id_equipo, prestamos!inner(fecha_prestamo, hora_inicio_prevista, hora_fin_prevista, estado)')
          .in('prestamos.estado', ['Reservado', 'En Curso']),
        cargarConfiguracionHorarios().catch(() => CONFIGURACION_HORARIOS_DEFECTO),
      ]);
      if (!active) return;

      const agendaMapeada: ReservaAgenda[] = ((dets ?? []) as any[])
        .map((d) => {
          const p = Array.isArray(d.prestamos) ? d.prestamos[0] : d.prestamos;
          if (!p) return null;
          return {
            id_prestamo: d.id_prestamo,
            id_equipo: d.id_equipo,
            fecha_prestamo: p.fecha_prestamo,
            hora_inicio_prevista: p.hora_inicio_prevista,
            hora_fin_prevista: p.hora_fin_prevista,
            estado: p.estado,
          };
        })
        .filter((x): x is ReservaAgenda => Boolean(x));

      setEquipos((e ?? []) as Equipo[]);
      setAgenda(agendaMapeada);
      setConfigHorarios(cfg);
      const init = estadoInicialConConfig(cfg, preferirMananaInicial);
      setFecha(init.fecha);
      setFranjaId(init.franjaId);
      setHoraInicioLibre(init.horaInicioLibre);
      setHoraDevolucion(init.horaDevolucion);
    })();
    return () => {
      active = false;
    };
  }, [preferirMananaInicial]);

  const usarFranjas = configHorarios.franjas_activas && configHorarios.franjas.length > 0;
  const franjasValidas = useMemo(
    () => franjasDisponiblesHastaCierre(configHorarios.franjas, configHorarios.hora_cierre_devolucion),
    [configHorarios.franjas, configHorarios.hora_cierre_devolucion],
  );
  const horasLibresValidas = useMemo(
    () => horasInicioLibresHastaCierre(configHorarios.hora_cierre_devolucion),
    [configHorarios.hora_cierre_devolucion],
  );
  const franjaSeleccionada: FranjaRetiro | undefined = useMemo(
    () => franjasValidas.find((f) => f.id === franjaId) ?? franjasValidas[0],
    [franjasValidas, franjaId],
  );

  const hoyISO = fechaLocalISO();
  const fechaMaxISO = sumarDiasISO(hoyISO, configHorarios.dias_anticipacion_max);
  const ahoraHHMM = horaLocalHHMMSS().slice(0, 5);
  const horaActualNum = parseInt(ahoraHHMM.slice(0, 2), 10);
  const fechaPasada = Boolean(fecha) && fecha < hoyISO;
  const superaAnticipacion = Boolean(fecha) && fecha > fechaMaxISO;
  const finDeSemanaBloqueado =
    Boolean(fecha) && !configHorarios.permitir_fines_de_semana && esFinDeSemanaISO(fecha);

  const horaInicioEfectiva = usarFranjas && franjaSeleccionada ? franjaSeleccionada.hora_clase : horaInicioLibre;

  const franjaCerrada =
    usarFranjas &&
    franjaSeleccionada &&
    fecha === hoyISO &&
    franjaYaCerroHoy(franjaSeleccionada, configHorarios.tolerancia_retiro_min);

  const horaLibrePasada =
    !usarFranjas && fecha === hoyISO && horaInicioLibre <= ahoraHHMM;

  const sinHorariosDisponibles = usarFranjas ? franjasValidas.length === 0 : horasLibresValidas.length === 0;
  const horarioPasado = fechaPasada || Boolean(franjaCerrada) || horaLibrePasada;
  const devolucionInvalida =
    !horaDevolucion || aMinutos(horaDevolucion) <= aMinutos(horaInicioEfectiva);
  const superaCierre =
    Boolean(horaDevolucion) && aMinutos(horaDevolucion) > aMinutos(configHorarios.hora_cierre_devolucion);

  const onCambiarFranja = (nuevoId: string) => {
    setFranjaId(nuevoId);
    const f = franjasValidas.find((x) => x.id === nuevoId);
    if (f) {
      setHoraDevolucion((actual) =>
        aMinutos(actual) <= aMinutos(f.hora_clase)
          ? sugerirDevolucion(f.hora_clase, configHorarios)
          : actual,
      );
    }
  };

  const onCambiarHoraLibre = (nuevaHora: string) => {
    setHoraInicioLibre(nuevaHora);
    setHoraDevolucion((actual) =>
      aMinutos(actual) <= aMinutos(nuevaHora)
        ? sugerirDevolucion(nuevaHora, configHorarios)
        : actual,
    );
  };

  const agendaPorEquipo = useMemo(() => {
    const map = new Map<string, ReservaAgenda[]>();
    for (const r of agenda) {
      const lista = map.get(r.id_equipo) ?? [];
      lista.push(r);
      map.set(r.id_equipo, lista);
    }
    return map;
  }, [agenda]);

  const conflictoEnBloque = useMemo(() => {
    return (eq: Equipo): string | null => {
      if (fecha === hoyISO && eq.estado === 'En préstamo') {
        return 'En préstamo ahora (sin devolver todavía)';
      }
      const reservas = agendaPorEquipo.get(eq.id_equipo) ?? [];
      const solapada = reservas.find((r) => {
        if (r.fecha_prestamo !== fecha) return false;
        if (!horaInicioEfectiva || !horaDevolucion) return false;
        return bloquesSeSolapan(
          horaInicioEfectiva,
          horaDevolucion,
          r.hora_inicio_prevista,
          r.hora_fin_prevista,
        );
      });
      if (solapada) {
        return `Ocupado ${solapada.hora_inicio_prevista.slice(0, 5)}–${solapada.hora_fin_prevista.slice(0, 5)}`;
      }
      return null;
    };
  }, [agendaPorEquipo, fecha, hoyISO, horaInicioEfectiva, horaDevolucion]);

  const otrosHorariosMismoDia = useMemo(() => {
    return (eq: Equipo): string[] => {
      const reservas = agendaPorEquipo.get(eq.id_equipo) ?? [];
      return reservas
        .filter((r) => {
          if (r.fecha_prestamo !== fecha) return false;
          if (!horaInicioEfectiva || !horaDevolucion) return true;
          return !bloquesSeSolapan(
            horaInicioEfectiva,
            horaDevolucion,
            r.hora_inicio_prevista,
            r.hora_fin_prevista,
          );
        })
        .sort((a, b) => a.hora_inicio_prevista.localeCompare(b.hora_inicio_prevista))
        .map((r) => `${r.hora_inicio_prevista.slice(0, 5)}–${r.hora_fin_prevista.slice(0, 5)}`);
    };
  }, [agendaPorEquipo, fecha, horaInicioEfectiva, horaDevolucion]);

  const cartConConflictos = useMemo(
    () =>
      cart
        .map((eq) => ({ equipo: eq, conflicto: conflictoEnBloque(eq) }))
        .filter((x): x is { equipo: Equipo; conflicto: string } => Boolean(x.conflicto)),
    [cart, conflictoEnBloque],
  );

  const available = useMemo(() => {
    const inCart = new Set(cart.map((c) => c.id_equipo));
    const query = q.trim().toLowerCase();
    return equipos
      .filter((eq) => {
        if (inCart.has(eq.id_equipo)) return false;
        if (!query) return true;
        const hay = [eq.codigo_inventario, eq.marca_modelo, eq.categorias_equipo?.nombre]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(query);
      })
      .sort((a, b) => {
        const ca = conflictoEnBloque(a) ? 1 : 0;
        const cb = conflictoEnBloque(b) ? 1 : 0;
        if (ca !== cb) return ca - cb;
        return a.codigo_inventario.localeCompare(b.codigo_inventario);
      });
  }, [equipos, cart, q, conflictoEnBloque]);

  const enCarrito = (categoriaId: string) => cart.filter((eq) => eq.id_categoria === categoriaId).length;
  const cupoBloqueado = (eq: Equipo): CupoCategoria | undefined => {
    const cupo = cupoDeEquipo(cupos, eq);
    return limitado && cupo && cupo.activas + enCarrito(eq.id_categoria) >= cupo.limite ? cupo : undefined;
  };
  const categoriasLlenas = limitado
    ? cupos.filter((c) => c.activas + enCarrito(c.id_categoria) >= c.limite)
    : [];
  const categoriaExcedida = limitado
    ? cupos.find((c) => c.activas + enCarrito(c.id_categoria) > c.limite)
    : undefined;

  const addToCart = (eq: Equipo) => setCart((c) => [...c, eq]);
  const removeFromCart = (id: string) => setCart((c) => c.filter((x) => x.id_equipo !== id));

  const submit = async () => {
    if (!session) return;
    setError(null);
    if (cart.length === 0) {
      setError('Agregá al menos un equipo al carrito.');
      return;
    }
    if (!fecha || fecha < hoyISO) {
      setError('No podés reservar para una fecha anterior a hoy.');
      return;
    }
    if (superaAnticipacion) {
      setError(
        `Solo podés reservar con hasta ${configHorarios.dias_anticipacion_max} día(s) de anticipación (máximo ${formatearFechaCorta(fechaMaxISO)}).`,
      );
      return;
    }
    if (finDeSemanaBloqueado) {
      setError('No se realizan reservas los sábados ni domingos.');
      return;
    }
    if (sinHorariosDisponibles) {
      setError(`No hay horarios habilitados antes del cierre (${configHorarios.hora_cierre_devolucion} hs).`);
      return;
    }
    if (usarFranjas) {
      if (!franjaSeleccionada) {
        setError('Elegí una franja de retiro válida.');
        return;
      }
      if (fecha === hoyISO && franjaYaCerroHoy(franjaSeleccionada, configHorarios.tolerancia_retiro_min)) {
        setError(
          `La franja ${franjaSeleccionada.etiqueta} ya cerró (era hasta las ${franjaSeleccionada.retiro_hasta} hs + ${configHorarios.tolerancia_retiro_min} min de tolerancia).`,
        );
        return;
      }
    } else if (fecha === hoyISO && horaInicioLibre <= horaLocalHHMMSS().slice(0, 5)) {
      setError(`El horario de las ${horaInicioLibre} ya pasó. Elegí una hora futura u otro día.`);
      return;
    }
    if (aMinutos(horaInicioEfectiva) >= aMinutos(configHorarios.hora_cierre_devolucion)) {
      setError(`El horario de inicio debe ser anterior al cierre (${configHorarios.hora_cierre_devolucion} hs).`);
      return;
    }
    if (devolucionInvalida) {
      setError('La hora de devolución debe ser posterior al horario de inicio.');
      return;
    }
    if (superaCierre) {
      setError(`La hora de devolución no puede superar las ${configHorarios.hora_cierre_devolucion} hs.`);
      return;
    }
    if (cartConConflictos.length > 0) {
      setError(
        `Quitá del carrito o cambiá el horario de los equipos con conflicto: ${cartConConflictos
          .map((x) => `${x.equipo.codigo_inventario} (${x.conflicto})`)
          .join(', ')}`,
      );
      return;
    }
    if (session.usuario.estado === 'Sancionado') {
      setError('Tu usuario está sancionado y no puede realizar reservas.');
      return;
    }

    setBusy(true);
    try {
      if (limitado) {
        const actuales = await cargarCuposEstudiante(session.usuario.id_usuario);
        setCupos(actuales);
        const excedida = actuales.find((c) => c.activas + enCarrito(c.id_categoria) > c.limite);
        if (excedida) {
          setError(mensajeLimiteCategoria(excedida));
          return;
        }
      }

      const horaInicio = `${horaInicioEfectiva}:00`;
      const horaFin = `${horaDevolucion}:00`;
      const equipoIds = cart.map((c) => c.id_equipo);

      // Verificar estado actual en vivo y superposición horaria para la fecha elegida
      const [{ data: equiposFrescos }, { data: solapados }] = await Promise.all([
        supabase
          .from('equipos')
          .select('id_equipo, codigo_inventario, estado, oculto_catalogo')
          .in('id_equipo', equipoIds),
        supabase
          .from('detalle_prestamos')
          .select('id_prestamo, id_equipo, prestamos!inner(fecha_prestamo, hora_inicio_prevista, hora_fin_prevista, estado)')
          .in('id_equipo', equipoIds)
          .in('prestamos.estado', ['Reservado', 'En Curso']),
      ]);

      const noOperativos = (equiposFrescos ?? []).filter(
        (e: any) =>
          e.oculto_catalogo === true ||
          e.estado === 'En mantenimiento' ||
          e.estado === 'Baja' ||
          (fecha <= hoyISO && e.estado === 'En préstamo'),
      );
      if (noOperativos.length > 0) {
        setError(
          `Algunos equipos no están disponibles para reservar: ${noOperativos
            .map((e: any) => `${e.codigo_inventario} (${e.oculto_catalogo ? 'Oculto' : e.estado})`)
            .join(', ')}`,
        );
        return;
      }

      const conflictivos = (solapados ?? []).filter((d: any) => {
        const p = Array.isArray(d.prestamos) ? d.prestamos[0] : d.prestamos;
        if (!p) return false;
        if (p.fecha_prestamo !== fecha) return false;
        return bloquesSeSolapan(
          horaInicioEfectiva,
          horaDevolucion,
          p.hora_inicio_prevista,
          p.hora_fin_prevista,
        );
      });

      if (conflictivos.length > 0) {
        const codigos = cart
          .filter((c) => conflictivos.some((c2: any) => c2.id_equipo === c.id_equipo))
          .map((c) => c.codigo_inventario);
        setError(`Algunos equipos ya están reservados en ese bloque: ${codigos.join(', ')}`);
        return;
      }

      const { data: prestamo, error: pErr } = await supabase
        .from('prestamos')
        .insert({
          id_usuario: session.usuario.id_usuario,
          fecha_prestamo: fecha,
          hora_inicio_prevista: horaInicio,
          hora_fin_prevista: horaFin,
          retiro_desde: usarFranjas && franjaSeleccionada ? `${franjaSeleccionada.retiro_desde}:00` : null,
          retiro_hasta: usarFranjas && franjaSeleccionada ? `${franjaSeleccionada.retiro_hasta}:00` : null,
          estado: 'Reservado',
        })
        .select()
        .single();

      if (pErr || !prestamo) throw new Error(pErr?.message ?? 'No se pudo crear la reserva');

      const detalles = cart.map((eq) => ({
        id_prestamo: prestamo.id_prestamo,
        id_equipo: eq.id_equipo,
      }));
      const { error: dErr } = await supabase.from('detalle_prestamos').insert(detalles);
      if (dErr) {
        await supabase.from('prestamos').delete().eq('id_prestamo', prestamo.id_prestamo);
        throw new Error(dErr.message);
      }

      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la reserva');
    } finally {
      setBusy(false);
    }
  };

  const bloqueoConfirmacion =
    busy ||
    !!categoriaExcedida ||
    sinHorariosDisponibles ||
    fechaPasada ||
    superaAnticipacion ||
    finDeSemanaBloqueado ||
    cartConConflictos.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="flex h-[92vh] w-full max-w-3xl flex-col rounded-t-2xl bg-white shadow-card dark:bg-gray-950 sm:h-auto sm:max-h-[88vh] sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
            <ShoppingCart size={18} className="text-brand-600" /> Nueva reserva
          </h2>
          <button type="button" onClick={onClose} className="btn-ghost h-9 w-9 !px-0">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Fecha, franja de retiro y devolución */}
          <div className="card mb-5 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
              <span className="flex items-center gap-2">
                <Calendar size={16} className="text-brand-600" /> Fecha, retiro y devolución
              </span>
              <span className="text-xs font-normal text-gray-500">
                {configHorarios.dias_anticipacion_max === 0
                  ? 'Solo reservas para hoy'
                  : `Anticipación: hasta ${configHorarios.dias_anticipacion_max} día(s) (${formatearFechaCorta(fechaMaxISO)})`}
                {' · '}Cierre pañol: {configHorarios.hora_cierre_devolucion} hs
                {usarFranjas ? ` · Tolerancia: ${configHorarios.tolerancia_retiro_min} min` : ''}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Fecha</label>
                <input
                  type="date"
                  className="input"
                  value={fecha}
                  min={hoyISO}
                  max={fechaMaxISO}
                  onChange={(e) => setFecha(e.target.value)}
                />
              </div>

              {usarFranjas ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">
                    Franja de retiro (turno)
                  </label>
                  <select
                    className="input"
                    value={franjaSeleccionada?.id ?? ''}
                    disabled={franjasValidas.length === 0}
                    onChange={(e) => onCambiarFranja(e.target.value)}
                  >
                    {franjasValidas.length === 0 ? (
                      <option value="">Sin franjas antes del cierre</option>
                    ) : (
                      franjasValidas.map((f) => {
                        const cerrada =
                          fecha === hoyISO && franjaYaCerroHoy(f, configHorarios.tolerancia_retiro_min);
                        return (
                          <option key={f.id} value={f.id} disabled={cerrada}>
                            {f.etiqueta} · {f.retiro_desde}–{f.retiro_hasta}
                            {cerrada ? ' (cerró)' : ''}
                          </option>
                        );
                      })
                    )}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">Hora inicio</label>
                  <select
                    className="input"
                    value={horaInicioLibre}
                    disabled={horasLibresValidas.length === 0}
                    onChange={(e) => onCambiarHoraLibre(e.target.value)}
                  >
                    {horasLibresValidas.length === 0 ? (
                      <option value="">Sin horarios antes del cierre</option>
                    ) : (
                      horasLibresValidas.map((h) => {
                        const val = `${pad(h)}:00`;
                        const pasada = fecha === hoyISO && h <= horaActualNum;
                        return (
                          <option key={h} value={val} disabled={pasada}>
                            {val}
                            {pasada ? ' (ya pasó)' : ''}
                          </option>
                        );
                      })
                    )}
                  </select>
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Hora devolución (máx. {configHorarios.hora_cierre_devolucion} hs)
                </label>
                <input
                  type="time"
                  className="input"
                  value={horaDevolucion}
                  max={configHorarios.hora_cierre_devolucion}
                  onChange={(e) => setHoraDevolucion(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-3 space-y-1 text-sm text-gray-600 dark:text-gray-300">
              <p className="flex flex-wrap items-center gap-2">
                <Clock size={15} className="text-brand-600" />
                {usarFranjas && franjaSeleccionada ? (
                  <>
                    Retiro en pañol:{' '}
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {franjaSeleccionada.retiro_desde} a {franjaSeleccionada.retiro_hasta} hs
                    </span>
                    <span className="text-xs text-gray-500">
                      (hasta +{configHorarios.tolerancia_retiro_min} min)
                    </span>
                    <span>· Devolución:</span>
                    <span className="font-semibold text-gray-900 dark:text-white">{horaDevolucion} hs</span>
                  </>
                ) : (
                  <>
                    Bloque:{' '}
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {horaInicioEfectiva} a {horaDevolucion} hs
                    </span>
                  </>
                )}
              </p>

              {superaAnticipacion && (
                <p className="text-xs font-medium text-red-600">
                  La fecha supera el límite de {configHorarios.dias_anticipacion_max} día(s) de anticipación (hasta{' '}
                  {formatearFechaCorta(fechaMaxISO)}).
                </p>
              )}
              {finDeSemanaBloqueado && (
                <p className="text-xs font-medium text-red-600">
                  No se realizan reservas los sábados ni domingos. Elegí un día hábil de lunes a viernes.
                </p>
              )}
              {sinHorariosDisponibles && (
                <p className="text-xs font-medium text-red-600">
                  No hay franjas de retiro habilitadas antes del cierre ({configHorarios.hora_cierre_devolucion} hs).
                </p>
              )}
              {horarioPasado && !sinHorariosDisponibles && (
                <p className="text-xs font-medium text-red-600">
                  La franja elegida ya cerró para hoy. Elegí un turno posterior u otro día.
                </p>
              )}
              {devolucionInvalida && !sinHorariosDisponibles && (
                <p className="text-xs font-medium text-red-600">
                  La hora de devolución debe ser posterior a las {horaInicioEfectiva} hs.
                </p>
              )}
              {superaCierre && (
                <p className="text-xs font-medium text-red-600">
                  La hora de devolución supera el cierre ({configHorarios.hora_cierre_devolucion} hs).
                </p>
              )}
            </div>
          </div>

          {/* Carrito */}
          <div className="card mb-5 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
              <ShoppingCart size={16} className="text-brand-600" /> Carrito
              <span className="ml-auto text-xs font-normal text-gray-500">
                {cart.length} equipo{cart.length === 1 ? '' : 's'}
              </span>
            </div>
            {cart.length === 0 ? (
              <p className="text-sm text-gray-500">El carrito está vacío. Agregá equipos abajo.</p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {cart.map((eq) => {
                  const conflicto = conflictoEnBloque(eq);
                  return (
                    <li key={eq.id_equipo} className="flex items-center gap-3 py-2.5">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {eq.codigo_inventario} · {eq.categorias_equipo?.nombre}
                        </p>
                        <p className="text-xs text-gray-500">{eq.marca_modelo ?? '—'}</p>
                        {conflicto && (
                          <p className="mt-0.5 text-xs font-medium text-red-600 dark:text-red-400">
                            No disponible en este día/horario: {conflicto}. Cambiá la fecha/turno o quitalo.
                          </p>
                        )}
                      </div>
                      <Badge variant={conflicto ? 'red' : estadoEquipoVariant(eq.estado)}>
                        {conflicto ? 'Conflicto' : eq.estado}
                      </Badge>
                      <button
                        type="button"
                        onClick={() => removeFromCart(eq.id_equipo)}
                        className="btn-ghost h-8 w-8 !px-0 text-red-500 hover:text-red-600"
                      >
                        <Trash2 size={16} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Selector de equipos disponibles para la fecha y bloque elegidos */}
          <div className="card p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
              <PlusCircle size={16} className="text-brand-600" /> Disponibilidad para {formatearFechaCorta(fecha)}{' '}
              ({horaInicioEfectiva}–{horaDevolucion || '…'})
              {limitado && cupos.length > 0 && (
                <span className="ml-auto flex gap-3 text-xs font-normal text-gray-500">
                  {cupos.map((c) => (
                    <span key={c.id_categoria}>
                      {c.nombre}: {c.activas}/{c.limite}
                    </span>
                  ))}
                </span>
              )}
            </div>
            {categoriasLlenas.map((c) => (
              <div
                key={c.id_categoria}
                className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-600 dark:bg-amber-950/30"
              >
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{mensajeLimiteCategoria(c)}</span>
              </div>
            ))}
            <input
              className="input mb-3"
              placeholder="Buscar equipo para agregar…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {available.length === 0 ? (
              <p className="text-sm text-gray-500">No hay equipos para mostrar.</p>
            ) : (
              <ul className="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                {available.map((eq) => {
                  const conflicto = conflictoEnBloque(eq);
                  const otros = otrosHorariosMismoDia(eq);
                  const cupo = cupoBloqueado(eq);
                  return (
                    <li
                      key={eq.id_equipo}
                      className={`flex items-center gap-2 rounded-lg border p-2.5 ${
                        conflicto
                          ? 'border-gray-200 bg-gray-50/70 opacity-75 dark:border-gray-800 dark:bg-gray-900/40'
                          : 'border-gray-200 dark:border-gray-800'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                          {eq.codigo_inventario}
                        </p>
                        <p className="truncate text-xs text-gray-500">
                          {eq.categorias_equipo?.nombre} · {eq.marca_modelo ?? '—'}
                        </p>
                        {conflicto ? (
                          <p className="mt-0.5 text-[11px] font-medium text-red-600 dark:text-red-400">
                            {conflicto}
                          </p>
                        ) : otros.length > 0 ? (
                          <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                            Otro turno ese día: {otros.join(', ')}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        disabled={!!conflicto || !!cupo}
                        onClick={() => addToCart(eq)}
                        className="btn-secondary h-8 shrink-0 px-2 text-xs"
                      >
                        {conflicto ? (
                          'Ocupado'
                        ) : cupo ? (
                          'Cupo lleno'
                        ) : (
                          <>
                            <PlusCircle size={14} /> Agregar
                          </>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
          <p className="text-xs text-gray-500">
            {cart.length} equipo(s) · {formatearFechaCorta(fecha)} ·{' '}
            {usarFranjas && franjaSeleccionada
              ? `retiro ${franjaSeleccionada.retiro_desde}–${franjaSeleccionada.retiro_hasta} · dev. ${horaDevolucion}`
              : `${horaInicioEfectiva}–${horaDevolucion}`}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-ghost">
              Cancelar
            </button>
            <button
              type="button"
              disabled={bloqueoConfirmacion}
              onClick={submit}
              className="btn-primary"
            >
              {busy ? 'Reservando…' : 'Confirmar reserva'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
