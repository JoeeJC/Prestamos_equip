import { fechaLocalISO, horaLocalHHMMSS } from '@/utils/fechas';
import { supabase } from '@/services/supabaseClient';
import type { ConfiguracionHorarios, FranjaRetiro, Prestamo } from '@/types/database';

export const FRANJAS_POR_DEFECTO: FranjaRetiro[] = [
  { id: 'f-1', etiqueta: '1ª hora (08:00)', retiro_desde: '07:50', retiro_hasta: '08:10', hora_clase: '08:00' },
  { id: 'f-2', etiqueta: '2ª hora (09:30)', retiro_desde: '09:15', retiro_hasta: '09:30', hora_clase: '09:30' },
  { id: 'f-3', etiqueta: '3ª hora (11:00)', retiro_desde: '10:45', retiro_hasta: '11:00', hora_clase: '11:00' },
  { id: 'f-4', etiqueta: '4ª hora (12:30)', retiro_desde: '12:15', retiro_hasta: '12:30', hora_clase: '12:30' },
  { id: 'f-5', etiqueta: '5ª hora (14:00)', retiro_desde: '13:45', retiro_hasta: '14:00', hora_clase: '14:00' },
  { id: 'f-6', etiqueta: '6ª hora (15:30)', retiro_desde: '15:15', retiro_hasta: '15:30', hora_clase: '15:30' },
  { id: 'f-7', etiqueta: '7ª hora (17:00)', retiro_desde: '16:45', retiro_hasta: '17:00', hora_clase: '17:00' },
  { id: 'f-8', etiqueta: '8ª hora (18:30)', retiro_desde: '18:15', retiro_hasta: '18:30', hora_clase: '18:30' },
  { id: 'f-9', etiqueta: '9ª hora (20:00)', retiro_desde: '19:45', retiro_hasta: '20:00', hora_clase: '20:00' },
];

export const CONFIGURACION_HORARIOS_DEFECTO: ConfiguracionHorarios = {
  id: 1,
  franjas_activas: true,
  tolerancia_retiro_min: 5,
  hora_cierre_devolucion: '22:00',
  dias_anticipacion_max: 7,
  permitir_fines_de_semana: false,
  franjas: FRANJAS_POR_DEFECTO,
};

export function aMinutos(hhmm: string): number {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export function aHHMM(minutosTotales: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutosTotales)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function sumarMinutosHHMM(hhmm: string, deltaMin: number): string {
  return aHHMM(aMinutos(hhmm) + deltaMin);
}

export function normalizarHHMM(valor?: string | null, fallback = '08:00'): string {
  if (!valor) return fallback;
  const match = /^(\d{1,2}):(\d{2})/.exec(valor.trim());
  if (!match) return fallback;
  const h = Math.min(23, Math.max(0, Number(match[1])));
  const m = Math.min(59, Math.max(0, Number(match[2])));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function sumarDiasISO(fechaISO: string, dias: number): string {
  const base = new Date(`${fechaISO}T12:00:00`);
  base.setDate(base.getDate() + dias);
  return fechaLocalISO(base);
}

export function esFinDeSemanaISO(fechaISO: string): boolean {
  if (!fechaISO) return false;
  const dia = new Date(`${fechaISO}T12:00:00`).getDay();
  return dia === 0 || dia === 6;
}

export function siguienteDiaHabilISO(
  fechaInicioISO: string,
  fechaMaxISO: string,
  permitirFinesDeSemana: boolean,
): string {
  if (permitirFinesDeSemana) return fechaInicioISO;
  let actual = fechaInicioISO;
  for (let i = 0; i < 14; i++) {
    if (actual > fechaMaxISO) return fechaInicioISO;
    if (!esFinDeSemanaISO(actual)) return actual;
    actual = sumarDiasISO(actual, 1);
  }
  return fechaInicioISO;
}

export function bloquesSeSolapan(
  inicioA: string,
  finA: string,
  inicioB: string,
  finB: string,
): boolean {
  const a0 = aMinutos(normalizarHHMM(inicioA));
  const a1 = aMinutos(normalizarHHMM(finA));
  const b0 = aMinutos(normalizarHHMM(inicioB));
  const b1 = aMinutos(normalizarHHMM(finB));
  return a0 < b1 && a1 > b0;
}

export function normalizarFranjas(raw: unknown): FranjaRetiro[] {
  if (!Array.isArray(raw)) return FRANJAS_POR_DEFECTO;
  return raw
    .map((item, idx): FranjaRetiro | null => {
      if (!item || typeof item !== 'object') return null;
      const obj = item as Record<string, unknown>;
      const desde = normalizarHHMM(String(obj.retiro_desde ?? ''), '');
      const hasta = normalizarHHMM(String(obj.retiro_hasta ?? ''), '');
      const clase = normalizarHHMM(String(obj.hora_clase ?? hasta), '');
      if (!desde || !hasta || !clase) return null;
      return {
        id: String(obj.id ?? `f-${idx + 1}`),
        etiqueta: String(obj.etiqueta ?? `${idx + 1}ª hora (${clase})`).trim() || `${idx + 1}ª hora (${clase})`,
        retiro_desde: desde,
        retiro_hasta: hasta,
        hora_clase: clase,
      };
    })
    .filter((f): f is FranjaRetiro => Boolean(f))
    .sort((a, b) => aMinutos(a.hora_clase) - aMinutos(b.hora_clase));
}

export function franjasDisponiblesHastaCierre(
  franjas: FranjaRetiro[],
  horaCierreDevolucion: string,
): FranjaRetiro[] {
  const cierreMin = aMinutos(normalizarHHMM(horaCierreDevolucion, '22:00'));
  return franjas.filter(
    (f) => aMinutos(f.hora_clase) < cierreMin && aMinutos(f.retiro_hasta) < cierreMin,
  );
}

export function horasInicioLibresHastaCierre(horaCierreDevolucion: string): number[] {
  const cierreMin = aMinutos(normalizarHHMM(horaCierreDevolucion, '22:00'));
  const horas: number[] = [];
  for (let h = 8; h <= 20; h++) {
    if (h * 60 < cierreMin) {
      horas.push(h);
    }
  }
  return horas;
}

export function generarGrillaFranjas({
  horaPrimeraClase,
  duracionClaseMin,
  recreoMin,
  anticipacionMin,
  primeraDesde,
  primeraHasta,
  cantidad,
  horaCierre = '22:00',
}: {
  horaPrimeraClase: string;
  duracionClaseMin: number;
  recreoMin: number;
  anticipacionMin: number;
  primeraDesde: string;
  primeraHasta: string;
  cantidad: number;
  horaCierre?: string;
}): FranjaRetiro[] {
  const resultado: FranjaRetiro[] = [];
  let inicioMin = aMinutos(horaPrimeraClase);
  const cierreMin = aMinutos(normalizarHHMM(horaCierre, '22:00'));
  const paso = Math.max(15, duracionClaseMin + recreoMin);

  for (let i = 0; i < cantidad; i++) {
    if (inicioMin >= cierreMin) break;
    const clase = aHHMM(inicioMin);
    const desde = i === 0 ? normalizarHHMM(primeraDesde, '07:50') : aHHMM(inicioMin - anticipacionMin);
    const hasta = i === 0 ? normalizarHHMM(primeraHasta, '08:10') : clase;
    if (aMinutos(hasta) >= cierreMin) break;
    resultado.push({
      id: `f-${i + 1}`,
      etiqueta: `${i + 1}ª hora (${clase})`,
      retiro_desde: desde,
      retiro_hasta: hasta,
      hora_clase: clase,
    });
    inicioMin += paso;
  }

  return resultado;
}

export async function cargarConfiguracionHorarios(): Promise<ConfiguracionHorarios> {
  const { data, error } = await supabase
    .from('configuracion_horarios')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (error || !data) {
    return CONFIGURACION_HORARIOS_DEFECTO;
  }

  return {
    id: 1,
    franjas_activas: Boolean(data.franjas_activas),
    tolerancia_retiro_min:
      typeof data.tolerancia_retiro_min === 'number'
        ? Math.min(60, Math.max(0, data.tolerancia_retiro_min))
        : 5,
    hora_cierre_devolucion: normalizarHHMM(data.hora_cierre_devolucion, '22:00'),
    dias_anticipacion_max:
      typeof data.dias_anticipacion_max === 'number'
        ? Math.min(90, Math.max(0, data.dias_anticipacion_max))
        : 7,
    permitir_fines_de_semana: Boolean(data.permitir_fines_de_semana),
    franjas: normalizarFranjas(data.franjas),
  };
}

export async function guardarConfiguracionHorarios(
  token: string,
  config: Omit<ConfiguracionHorarios, 'id'>,
): Promise<ConfiguracionHorarios> {
  const franjasOrdenadas = [...config.franjas]
    .map((f, idx) => ({
      id: f.id || `f-${idx + 1}`,
      etiqueta: f.etiqueta.trim() || `${idx + 1}ª hora (${f.hora_clase})`,
      retiro_desde: normalizarHHMM(f.retiro_desde),
      retiro_hasta: normalizarHHMM(f.retiro_hasta),
      hora_clase: normalizarHHMM(f.hora_clase),
    }))
    .sort((a, b) => aMinutos(a.hora_clase) - aMinutos(b.hora_clase));

  const { data, error } = await supabase.rpc('admin_guardar_configuracion_horarios', {
    p_token: token,
    p_franjas_activas: config.franjas_activas,
    p_tolerancia_retiro_min: config.tolerancia_retiro_min,
    p_hora_cierre_devolucion: `${normalizarHHMM(config.hora_cierre_devolucion)}:00`,
    p_franjas: franjasOrdenadas,
    p_dias_anticipacion_max: Math.min(90, Math.max(0, Math.round(config.dias_anticipacion_max))),
    p_permitir_fines_de_semana: Boolean(config.permitir_fines_de_semana),
  });

  if (error) throw new Error(error.message);

  const row = (data ?? {}) as Partial<ConfiguracionHorarios>;
  return {
    id: 1,
    franjas_activas: row.franjas_activas ?? config.franjas_activas,
    tolerancia_retiro_min: row.tolerancia_retiro_min ?? config.tolerancia_retiro_min,
    hora_cierre_devolucion: normalizarHHMM(row.hora_cierre_devolucion, config.hora_cierre_devolucion),
    dias_anticipacion_max:
      typeof row.dias_anticipacion_max === 'number'
        ? row.dias_anticipacion_max
        : config.dias_anticipacion_max,
    permitir_fines_de_semana:
      typeof row.permitir_fines_de_semana === 'boolean'
        ? row.permitir_fines_de_semana
        : config.permitir_fines_de_semana,
    franjas: normalizarFranjas(row.franjas ?? franjasOrdenadas),
  };
}

export async function cambiarEquipoEnPrestamo(
  token: string,
  params: {
    idPrestamo: string;
    idDetalle: string;
    idEquipoNuevo: string;
    estadoEquipoAnterior: 'Disponible' | 'En mantenimiento';
    motivo: string;
  },
): Promise<{ equipo_anterior: string; equipo_nuevo: string }> {
  const { data, error } = await supabase.rpc('admin_cambiar_equipo_prestamo', {
    p_token: token,
    p_id_prestamo: params.idPrestamo,
    p_id_detalle: params.idDetalle,
    p_id_equipo_nuevo: params.idEquipoNuevo,
    p_estado_equipo_anterior: params.estadoEquipoAnterior,
    p_motivo: params.motivo.trim() || null,
  });
  if (error) throw new Error(error.message);
  return (data ?? { equipo_anterior: '', equipo_nuevo: '' }) as {
    equipo_anterior: string;
    equipo_nuevo: string;
  };
}

export type EstadoVentanaRetiro =
  | { estado: 'sin_franja' }
  | { estado: 'en_horario'; desde: string; hasta: string; limiteConTolerancia: string }
  | { estado: 'antes'; desde: string; hasta: string; limiteConTolerancia: string; mensaje: string }
  | { estado: 'vencido'; desde: string; hasta: string; limiteConTolerancia: string; mensaje: string }
  | { estado: 'otro_dia'; desde: string; hasta: string; limiteConTolerancia: string; mensaje: string };

export function evaluarVentanaRetiro(
  prestamo: Pick<Prestamo, 'fecha_prestamo' | 'retiro_desde' | 'retiro_hasta'>,
  toleranciaMin: number,
): EstadoVentanaRetiro {
  if (!prestamo.retiro_desde || !prestamo.retiro_hasta) {
    return { estado: 'sin_franja' };
  }

  const desde = normalizarHHMM(prestamo.retiro_desde);
  const hasta = normalizarHHMM(prestamo.retiro_hasta);
  const limiteConTolerancia = sumarMinutosHHMM(hasta, toleranciaMin);
  const hoy = fechaLocalISO();
  const ahoraHHMM = horaLocalHHMMSS().slice(0, 5);

  if (prestamo.fecha_prestamo > hoy) {
    const fechaFmt = new Date(`${prestamo.fecha_prestamo}T00:00:00`).toLocaleDateString('es-AR');
    return {
      estado: 'otro_dia',
      desde,
      hasta,
      limiteConTolerancia,
      mensaje: `Esta reserva corresponde al ${fechaFmt} (retiro de ${desde} a ${hasta} hs).`,
    };
  }

  if (prestamo.fecha_prestamo < hoy) {
    return {
      estado: 'vencido',
      desde,
      hasta,
      limiteConTolerancia,
      mensaje: `La reserva venció (era de ${desde} a ${hasta} hs + ${toleranciaMin} min de tolerancia).`,
    };
  }

  const ahoraMin = aMinutos(ahoraHHMM);
  if (ahoraMin < aMinutos(desde)) {
    return {
      estado: 'antes',
      desde,
      hasta,
      limiteConTolerancia,
      mensaje: `Todavía no abrió la franja de retiro. Se habilita de ${desde} a ${hasta} hs (tolerancia ${toleranciaMin} min).`,
    };
  }

  if (ahoraMin > aMinutos(hasta) + toleranciaMin) {
    return {
      estado: 'vencido',
      desde,
      hasta,
      limiteConTolerancia,
      mensaje: `Venció la ventana de retiro (${desde} a ${hasta} hs + ${toleranciaMin} min de tolerancia, hasta las ${limiteConTolerancia} hs).`,
    };
  }

  return { estado: 'en_horario', desde, hasta, limiteConTolerancia };
}

export function franjaYaCerroHoy(franja: FranjaRetiro, toleranciaMin: number): boolean {
  const ahoraMin = aMinutos(horaLocalHHMMSS().slice(0, 5));
  return ahoraMin > aMinutos(franja.retiro_hasta) + toleranciaMin;
}

export type EstadoVencimientoPrestamo = {
  vencido: boolean;
  porCierre: boolean;
  deFechaAnterior: boolean;
  minutosAtraso: number;
  etiqueta: string;
};

export function evaluarVencimientoPrestamoEnCurso(
  prestamo: Pick<Prestamo, 'estado' | 'fecha_prestamo' | 'hora_fin_prevista'>,
  cfg: Pick<ConfiguracionHorarios, 'hora_cierre_devolucion' | 'tolerancia_retiro_min'>,
  ahora = new Date(),
): EstadoVencimientoPrestamo {
  if (prestamo.estado !== 'En Curso') {
    return {
      vencido: false,
      porCierre: false,
      deFechaAnterior: false,
      minutosAtraso: 0,
      etiqueta: '',
    };
  }

  const hoy = fechaLocalISO(ahora);
  if (prestamo.fecha_prestamo < hoy) {
    const [y, m, d] = prestamo.fecha_prestamo.split('-');
    return {
      vencido: true,
      porCierre: true,
      deFechaAnterior: true,
      minutosAtraso: 0,
      etiqueta: `Sin devolver (${d}/${m}/${y})`,
    };
  }

  if (prestamo.fecha_prestamo > hoy) {
    return {
      vencido: false,
      porCierre: false,
      deFechaAnterior: false,
      minutosAtraso: 0,
      etiqueta: '',
    };
  }

  const ahoraMin = aMinutos(horaLocalHHMMSS(ahora).slice(0, 5));
  const finMin = aMinutos(normalizarHHMM(prestamo.hora_fin_prevista, '22:00'));
  const cierreMin = aMinutos(normalizarHHMM(cfg.hora_cierre_devolucion, '22:00'));
  const tolMin = Math.max(0, cfg.tolerancia_retiro_min ?? 0);

  const pasoCierre = ahoraMin > cierreMin;
  const expiroTolerancia = ahoraMin > finMin + tolMin;

  if (!pasoCierre && !expiroTolerancia) {
    return {
      vencido: false,
      porCierre: false,
      deFechaAnterior: false,
      minutosAtraso: 0,
      etiqueta: '',
    };
  }

  const referenciaMin = pasoCierre ? Math.min(finMin, cierreMin) : finMin;
  const minutosAtraso = Math.max(1, ahoraMin - referenciaMin);
  const etiqueta = pasoCierre
    ? `Vencido · Pasó el cierre (+${minutosAtraso} min)`
    : `Vencido · hace ${minutosAtraso} min`;

  return {
    vencido: true,
    porCierre: pasoCierre,
    deFechaAnterior: false,
    minutosAtraso,
    etiqueta,
  };
}

