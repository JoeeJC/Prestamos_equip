import * as XLSX from 'xlsx';
import { fechaLocalISO } from '@/utils/fechas';
import type { Categoria, Equipo, Prestamo } from '@/types/database';

export type PresetPeriodo = 'ultimos30' | 'mes' | 'c1' | 'c2' | 'anio' | 'personalizado';

export type CuatrimestresConfig = {
  c1Inicio: number; // 1..12
  c1Fin: number; // 1..12
  c2Inicio: number; // 1..12
  c2Fin: number; // 1..12
};

export const CUATRIMESTRES_DEFAULT: CuatrimestresConfig = {
  c1Inicio: 3,
  c1Fin: 7,
  c2Inicio: 8,
  c2Fin: 12,
};

const STORAGE_CUATRIMESTRES = 'itu_config_cuatrimestres_v1';

export const MESES_NOMBRES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

export const MESES_CORTOS = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
] as const;

const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;
const ORDEN_DIAS_LABORALES = [1, 2, 3, 4, 5, 6, 0];

export type PrestamoReporte = Prestamo & {
  usuarios?: {
    id_usuario: string;
    dni: string;
    nombre: string;
    apellido: string;
    curso?: string | null;
    usuario_roles?: { roles?: { id_rol: string; nombre: string } | null }[];
  } | null;
  detalle_prestamos?: {
    id_detalle: string;
    id_equipo: string;
    estado_salida: string | null;
    estado_devolucion: string | null;
    equipos?: Pick<Equipo, 'id_equipo' | 'id_categoria' | 'codigo_inventario' | 'marca_modelo' | 'estado'> | null;
  }[];
};

export type EstadisticasPeriodo = {
  totalSolicitudes: number;
  prestamosEfectivos: number;
  entregasEquipos: number;
  reservadosPendientes: number;
  noPresentados: number;
  cancelados: number;
  tasaAusenciaPct: number;
  tasaCancelacionPct: number;
  horasTotales: number;
  duracionPromedioMin: number;
  devolucionesEvaluadas: number;
  devolucionesATiempo: number;
  devolucionesTarde: number;
  puntualidadPct: number | null;
  retirosQrCodigo: number;
  retirosManual: number;
  porMes: {
    mesKey: string;
    etiqueta: string;
    efectivos: number;
    noPresentados: number;
    cancelados: number;
    horas: number;
  }[];
  porDiaSemana: { dia: string; efectivos: number }[];
  porFranja: { hora: string; cantidad: number; porcentaje: number }[];
  porCategoria: {
    id_categoria: string;
    nombre: string;
    usosEquipos: number;
    prestamosDistintos: number;
    horas: number;
    conObservaciones: number;
  }[];
  porCurso: {
    curso: string;
    prestamos: number;
    equipos: number;
    noPresentados: number;
    horas: number;
    porcentaje: number;
  }[];
  porRol: {
    rol: string;
    prestamos: number;
    equipos: number;
  }[];
  equiposMasUsados: {
    id_equipo: string;
    codigo_inventario: string;
    categoria: string;
    marca_modelo: string;
    estadoActual: Equipo['estado'];
    usos: number;
    horas: number;
    ultimoUso: string | null;
    reservasProximas: number;
    observacionesCount: number;
  }[];
  equiposMenosUsados: {
    id_equipo: string;
    codigo_inventario: string;
    categoria: string;
    marca_modelo: string;
    estadoActual: Equipo['estado'];
    usos: number;
    horas: number;
    ultimoUso: string | null;
    reservasProximas: number;
    observacionesCount: number;
  }[];
  equiposSinUso: {
    id_equipo: string;
    codigo_inventario: string;
    categoria: string;
    marca_modelo: string;
    estadoActual: Equipo['estado'];
  }[];
  equiposConObservaciones: {
    id_equipo: string;
    codigo_inventario: string;
    categoria: string;
    marca_modelo: string;
    estadoActual: Equipo['estado'];
    observacionesCount: number;
    ultimaNota: string | null;
  }[];
  detalleExportable: {
    fecha: string;
    horarioPrevisto: string;
    estado: Prestamo['estado'];
    usuario: string;
    dni: string;
    curso: string;
    rol: string;
    equipos: string;
    devolucionReal: string;
    puntualidad: string;
    horas: number;
    observaciones: string;
  }[];
};

export function cargarConfigCuatrimestres(): CuatrimestresConfig {
  if (typeof window === 'undefined') return CUATRIMESTRES_DEFAULT;
  try {
    const raw = localStorage.getItem(STORAGE_CUATRIMESTRES);
    if (!raw) return CUATRIMESTRES_DEFAULT;
    const p = JSON.parse(raw) as Partial<CuatrimestresConfig>;
    const valid = (n: unknown, def: number) =>
      typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 12 ? n : def;
    const c1Inicio = valid(p.c1Inicio, CUATRIMESTRES_DEFAULT.c1Inicio);
    const c1Fin = Math.max(c1Inicio, valid(p.c1Fin, CUATRIMESTRES_DEFAULT.c1Fin));
    const c2Inicio = valid(p.c2Inicio, CUATRIMESTRES_DEFAULT.c2Inicio);
    const c2Fin = Math.max(c2Inicio, valid(p.c2Fin, CUATRIMESTRES_DEFAULT.c2Fin));
    return { c1Inicio, c1Fin, c2Inicio, c2Fin };
  } catch {
    return CUATRIMESTRES_DEFAULT;
  }
}

export function guardarConfigCuatrimestres(cfg: CuatrimestresConfig): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_CUATRIMESTRES, JSON.stringify(cfg));
}

function ultimoDiaMesISO(anio: number, mes1a12: number): string {
  const ultimo = new Date(anio, mes1a12, 0).getDate();
  return `${anio}-${String(mes1a12).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`;
}

function primerDiaMesISO(anio: number, mes1a12: number): string {
  return `${anio}-${String(mes1a12).padStart(2, '0')}-01`;
}

export function calcularRangoPeriodo(
  preset: PresetPeriodo,
  anio: number,
  cfg: CuatrimestresConfig,
): { desde: string; hasta: string } {
  const hoy = new Date();
  const hoyIso = fechaLocalISO(hoy);

  if (preset === 'ultimos30') {
    const d = new Date(hoy);
    d.setDate(d.getDate() - 29);
    return { desde: fechaLocalISO(d), hasta: hoyIso };
  }
  if (preset === 'mes') {
    const m = hoy.getMonth() + 1;
    const y = hoy.getFullYear();
    return { desde: primerDiaMesISO(y, m), hasta: ultimoDiaMesISO(y, m) };
  }
  if (preset === 'c1') {
    return {
      desde: primerDiaMesISO(anio, cfg.c1Inicio),
      hasta: ultimoDiaMesISO(anio, Math.max(cfg.c1Inicio, cfg.c1Fin)),
    };
  }
  if (preset === 'c2') {
    return {
      desde: primerDiaMesISO(anio, cfg.c2Inicio),
      hasta: ultimoDiaMesISO(anio, Math.max(cfg.c2Inicio, cfg.c2Fin)),
    };
  }
  if (preset === 'anio') {
    return { desde: `${anio}-01-01`, hasta: `${anio}-12-31` };
  }
  return { desde: primerDiaMesISO(hoy.getFullYear(), hoy.getMonth() + 1), hasta: hoyIso };
}

function minutosDesdeHHMM(hhmm: string): number {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function duracionMinutosPrestamo(p: PrestamoReporte): number {
  if (p.estado === 'Devuelto' && p.hora_retiro_real && p.hora_devolucion_real) {
    const ini = new Date(p.hora_retiro_real).getTime();
    const fin = new Date(p.hora_devolucion_real).getTime();
    if (Number.isFinite(ini) && Number.isFinite(fin) && fin > ini) {
      const diffMin = Math.round((fin - ini) / 60000);
      if (diffMin > 0 && diffMin <= 24 * 60) return diffMin;
    }
  }
  const planned = minutosDesdeHHMM(p.hora_fin_prevista) - minutosDesdeHHMM(p.hora_inicio_prevista);
  return Math.max(0, planned);
}

function evaluarPuntualidadDevolucion(
  p: PrestamoReporte,
  toleranciaMin: number,
): 'a_tiempo' | 'tarde' | null {
  if (p.estado !== 'Devuelto' || !p.hora_devolucion_real) return null;
  const devDate = new Date(p.hora_devolucion_real);
  if (Number.isNaN(devDate.getTime())) return null;
  const fechaDev = fechaLocalISO(devDate);
  if (fechaDev > p.fecha_prestamo) return 'tarde';
  if (fechaDev < p.fecha_prestamo) return 'a_tiempo';
  const minDev = devDate.getHours() * 60 + devDate.getMinutes();
  const minLimite = minutosDesdeHHMM(p.hora_fin_prevista) + toleranciaMin;
  return minDev <= minLimite ? 'a_tiempo' : 'tarde';
}

function rolPrincipalUsuario(u: PrestamoReporte['usuarios']): string {
  const nombres = (u?.usuario_roles ?? [])
    .map((ur) => ur.roles?.nombre)
    .filter((n): n is string => Boolean(n));
  if (nombres.includes('Administrativo')) return 'Administrativo';
  if (nombres.includes('Profesor Adjunto')) return 'Profesor Adjunto';
  if (nombres.includes('Estudiante')) return 'Estudiante';
  return 'Sin rol';
}

export function formatearFechaCorta(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export function esCategoriaNotebook(nombreCategoria: string): boolean {
  return nombreCategoria.toLowerCase().includes('notebook');
}

function etiquetaMesKey(mesKey: string): string {
  const [y, m] = mesKey.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return mesKey;
  return `${MESES_CORTOS[m - 1]} ${y}`;
}

export function calcularEstadisticasPeriodo(
  prestamos: PrestamoReporte[],
  equipos: Equipo[],
  categorias: Categoria[],
  categoriaIdFiltro: string,
  toleranciaMin = 5,
  reservasProximasPorEquipo?: Map<string, number>,
): EstadisticasPeriodo {
  const catPorId = new Map(categorias.map((c) => [c.id_categoria, c.nombre]));
  const eqPorId = new Map(equipos.map((e) => [e.id_equipo, e]));

  const prestamosFiltrados = prestamos
    .map((p) => {
      const detalles = p.detalle_prestamos ?? [];
      if (!categoriaIdFiltro) return { p, detalles };
      const detallesCat = detalles.filter((d) => {
        const catId = d.equipos?.id_categoria ?? eqPorId.get(d.id_equipo)?.id_categoria;
        return catId === categoriaIdFiltro;
      });
      return { p, detalles: detallesCat };
    })
    .filter((item) => !categoriaIdFiltro || item.detalles.length > 0);

  const totalSolicitudes = prestamosFiltrados.length;
  let prestamosEfectivos = 0;
  let entregasEquipos = 0;
  let reservadosPendientes = 0;
  let noPresentados = 0;
  let cancelados = 0;
  let minutosTotales = 0;
  let devolucionesEvaluadas = 0;
  let devolucionesATiempo = 0;
  let devolucionesTarde = 0;
  let retirosQrCodigo = 0;
  let retirosManual = 0;

  const mesMap = new Map<
    string,
    { mesKey: string; efectivos: number; noPresentados: number; cancelados: number; minutos: number }
  >();
  const diaCounts = new Array<number>(7).fill(0);
  const franjaMap = new Map<string, number>();
  const catStats = new Map<
    string,
    { id_categoria: string; nombre: string; usosEquipos: number; prestamosSet: Set<string>; minutos: number; conObs: number }
  >();
  const cursoStats = new Map<
    string,
    { curso: string; prestamos: number; equipos: number; noPresentados: number; minutos: number }
  >();
  const rolStats = new Map<string, { rol: string; prestamos: number; equipos: number }>();

  const equipoStats = new Map<
    string,
    {
      id_equipo: string;
      codigo_inventario: string;
      categoria: string;
      marca_modelo: string;
      estadoActual: Equipo['estado'];
      ocultoCatalogo: boolean;
      usos: number;
      minutos: number;
      ultimoUsoFecha: string;
      obsCount: number;
      ultimaNota: string | null;
      ultimaFechaNota: string;
    }
  >();

  for (const eq of equipos) {
    if (categoriaIdFiltro && eq.id_categoria !== categoriaIdFiltro) continue;
    equipoStats.set(eq.id_equipo, {
      id_equipo: eq.id_equipo,
      codigo_inventario: eq.codigo_inventario,
      categoria: catPorId.get(eq.id_categoria) ?? 'Sin categoría',
      marca_modelo: eq.marca_modelo ?? '—',
      estadoActual: eq.estado,
      ocultoCatalogo: Boolean(eq.oculto_catalogo),
      usos: 0,
      minutos: 0,
      ultimoUsoFecha: '',
      obsCount: 0,
      ultimaNota: eq.estado === 'En mantenimiento' && eq.observaciones ? eq.observaciones : null,
      ultimaFechaNota: '',
    });
  }

  const detalleExportable: EstadisticasPeriodo['detalleExportable'] = [];

  for (const { p, detalles } of prestamosFiltrados) {
    const mesKey = p.fecha_prestamo.slice(0, 7);
    if (!mesMap.has(mesKey)) {
      mesMap.set(mesKey, { mesKey, efectivos: 0, noPresentados: 0, cancelados: 0, minutos: 0 });
    }
    const mesRow = mesMap.get(mesKey)!;

    const esEfectivo = p.estado === 'Devuelto' || p.estado === 'En Curso';
    if (p.estado === 'Reservado') reservadosPendientes++;
    if (p.estado === 'No Presentado') {
      noPresentados++;
      mesRow.noPresentados++;
    }
    if (p.estado === 'Cancelado') {
      cancelados++;
      mesRow.cancelados++;
    }

    const durMin = esEfectivo ? duracionMinutosPrestamo(p) : 0;
    const puntual = evaluarPuntualidadDevolucion(p, toleranciaMin);
    const cursoLabel = p.usuarios?.curso?.trim() || 'Sin curso';
    const rolLabel = rolPrincipalUsuario(p.usuarios);

    if (!cursoStats.has(cursoLabel)) {
      cursoStats.set(cursoLabel, { curso: cursoLabel, prestamos: 0, equipos: 0, noPresentados: 0, minutos: 0 });
    }
    const cRow = cursoStats.get(cursoLabel)!;
    if (p.estado === 'No Presentado') cRow.noPresentados++;

    if (esEfectivo) {
      prestamosEfectivos++;
      entregasEquipos += detalles.length;
      minutosTotales += durMin;
      mesRow.efectivos++;
      mesRow.minutos += durMin;

      const [yy, mm, dd] = p.fecha_prestamo.split('-').map(Number);
      if (yy && mm && dd) {
        const dow = new Date(yy, mm - 1, dd).getDay();
        diaCounts[dow]++;
      }

      const franja = p.hora_inicio_prevista.slice(0, 5);
      franjaMap.set(franja, (franjaMap.get(franja) ?? 0) + 1);

      if (p.metodo_entrega === 'qr' || p.metodo_entrega === 'codigo') retirosQrCodigo++;
      else if (p.metodo_entrega === 'manual') retirosManual++;

      if (puntual) {
        devolucionesEvaluadas++;
        if (puntual === 'a_tiempo') devolucionesATiempo++;
        else devolucionesTarde++;
      }

      cRow.prestamos++;
      cRow.equipos += detalles.length;
      cRow.minutos += durMin;

      if (!rolStats.has(rolLabel)) {
        rolStats.set(rolLabel, { rol: rolLabel, prestamos: 0, equipos: 0 });
      }
      const rRow = rolStats.get(rolLabel)!;
      rRow.prestamos++;
      rRow.equipos += detalles.length;

      for (const d of detalles) {
        const eq = eqPorId.get(d.id_equipo);
        const catId = d.equipos?.id_categoria ?? eq?.id_categoria ?? 'sin-cat';
        const catNombre = catPorId.get(catId) ?? 'Sin categoría';

        if (!catStats.has(catId)) {
          catStats.set(catId, {
            id_categoria: catId,
            nombre: catNombre,
            usosEquipos: 0,
            prestamosSet: new Set(),
            minutos: 0,
            conObs: 0,
          });
        }
        const cs = catStats.get(catId)!;
        cs.usosEquipos++;
        cs.prestamosSet.add(p.id_prestamo);
        cs.minutos += durMin;

        const notaDetalle = [d.estado_devolucion, p.observaciones_devolucion, d.estado_salida, p.observaciones_entrega]
          .map((x) => x?.trim())
          .filter(Boolean)
          .join(' · ');
        const tieneObs = Boolean(notaDetalle);
        if (tieneObs) cs.conObs++;

        if (!equipoStats.has(d.id_equipo)) {
          equipoStats.set(d.id_equipo, {
            id_equipo: d.id_equipo,
            codigo_inventario: d.equipos?.codigo_inventario ?? eq?.codigo_inventario ?? '—',
            categoria: catNombre,
            marca_modelo: d.equipos?.marca_modelo ?? eq?.marca_modelo ?? '—',
            estadoActual: d.equipos?.estado ?? eq?.estado ?? 'Disponible',
            ocultoCatalogo: Boolean(eq?.oculto_catalogo),
            usos: 0,
            minutos: 0,
            ultimoUsoFecha: '',
            obsCount: 0,
            ultimaNota: null,
            ultimaFechaNota: '',
          });
        }
        const es = equipoStats.get(d.id_equipo)!;
        es.usos++;
        es.minutos += durMin;
        if (p.fecha_prestamo > es.ultimoUsoFecha) {
          es.ultimoUsoFecha = p.fecha_prestamo;
        }
        if (tieneObs) {
          es.obsCount++;
          if (p.fecha_prestamo >= es.ultimaFechaNota) {
            es.ultimaFechaNota = p.fecha_prestamo;
            es.ultimaNota = notaDetalle;
          }
        }
      }
    }

    const codigosEq = detalles
      .map((d) => d.equipos?.codigo_inventario ?? eqPorId.get(d.id_equipo)?.codigo_inventario ?? d.id_equipo)
      .join(', ');
    const devReal =
      p.hora_devolucion_real && !Number.isNaN(new Date(p.hora_devolucion_real).getTime())
        ? new Date(p.hora_devolucion_real).toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })
        : '—';
    const puntualTxt =
      puntual === 'a_tiempo' ? 'A tiempo' : puntual === 'tarde' ? 'Fuera de hora' : '—';
    const obsGeneral = [
      p.observaciones_entrega,
      p.observaciones_devolucion,
      ...detalles.flatMap((d) => [d.estado_salida, d.estado_devolucion]),
    ]
      .map((x) => x?.trim())
      .filter(Boolean)
      .join(' | ');

    detalleExportable.push({
      fecha: p.fecha_prestamo,
      horarioPrevisto: `${p.hora_inicio_prevista.slice(0, 5)}–${p.hora_fin_prevista.slice(0, 5)}`,
      estado: p.estado,
      usuario: p.usuarios ? `${p.usuarios.apellido}, ${p.usuarios.nombre}` : 'Usuario eliminado',
      dni: p.usuarios?.dni ?? '—',
      curso: cursoLabel,
      rol: rolLabel,
      equipos: codigosEq || '—',
      devolucionReal: devReal,
      puntualidad: puntualTxt,
      horas: Number((durMin / 60).toFixed(1)),
      observaciones: obsGeneral || '—',
    });
  }

  const porMes = Array.from(mesMap.values())
    .sort((a, b) => a.mesKey.localeCompare(b.mesKey))
    .map((m) => ({
      mesKey: m.mesKey,
      etiqueta: etiquetaMesKey(m.mesKey),
      efectivos: m.efectivos,
      noPresentados: m.noPresentados,
      cancelados: m.cancelados,
      horas: Number((m.minutos / 60).toFixed(1)),
    }));

  const porDiaSemana = ORDEN_DIAS_LABORALES.map((idx) => ({
    dia: DIAS_SEMANA[idx],
    efectivos: diaCounts[idx],
  }));

  const porFranja = Array.from(franjaMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([hora, cantidad]) => ({
      hora,
      cantidad,
      porcentaje: prestamosEfectivos > 0 ? Math.round((cantidad / prestamosEfectivos) * 100) : 0,
    }));

  const porCategoria = Array.from(catStats.values())
    .map((c) => ({
      id_categoria: c.id_categoria,
      nombre: c.nombre,
      usosEquipos: c.usosEquipos,
      prestamosDistintos: c.prestamosSet.size,
      horas: Number((c.minutos / 60).toFixed(1)),
      conObservaciones: c.conObs,
    }))
    .sort((a, b) => b.usosEquipos - a.usosEquipos);

  const cursosVisibles = ['1°', '2°', '3°', 'Egresado'] as const;
  const totalPrestamosCursos = cursosVisibles.reduce(
    (acc, curso) => acc + (cursoStats.get(curso)?.prestamos ?? 0),
    0,
  );
  const porCurso = cursosVisibles.map((curso) => {
    const c = cursoStats.get(curso);
    const prestamosCurso = c?.prestamos ?? 0;
    return {
      curso,
      prestamos: prestamosCurso,
      equipos: c?.equipos ?? 0,
      noPresentados: c?.noPresentados ?? 0,
      horas: Number(((c?.minutos ?? 0) / 60).toFixed(1)),
      porcentaje:
        totalPrestamosCursos > 0 ? Math.round((prestamosCurso / totalPrestamosCursos) * 100) : 0,
    };
  });

  const ordenRoles = ['Estudiante', 'Profesor Adjunto', 'Administrativo', 'Sin rol'];
  const porRol = Array.from(rolStats.values()).sort(
    (a, b) => ordenRoles.indexOf(a.rol) - ordenRoles.indexOf(b.rol),
  );

  const todosEquiposStats = Array.from(equipoStats.values());
  const aItemUso = (e: (typeof todosEquiposStats)[number]) => ({
    id_equipo: e.id_equipo,
    codigo_inventario: e.codigo_inventario,
    categoria: e.categoria,
    marca_modelo: e.marca_modelo,
    estadoActual: e.estadoActual,
    usos: e.usos,
    horas: Number((e.minutos / 60).toFixed(1)),
    ultimoUso: e.ultimoUsoFecha ? formatearFechaCorta(e.ultimoUsoFecha) : null,
    reservasProximas: reservasProximasPorEquipo?.get(e.id_equipo) ?? 0,
    observacionesCount: e.obsCount,
  });

  const esEquipoOperativo = (estado: Equipo['estado']) =>
    estado !== 'Baja' && estado !== 'En mantenimiento';

  const equiposMasUsados = todosEquiposStats
    .filter((e) => e.usos > 0 && esEquipoOperativo(e.estadoActual) && !e.ocultoCatalogo)
    .map(aItemUso)
    .sort((a, b) => b.usos - a.usos || b.horas - a.horas);

  const equiposMenosUsados = todosEquiposStats
    .filter((e) => esEquipoOperativo(e.estadoActual) && !e.ocultoCatalogo)
    .map(aItemUso)
    .sort(
      (a, b) =>
        a.usos - b.usos ||
        a.horas - b.horas ||
        a.reservasProximas - b.reservasProximas ||
        a.codigo_inventario.localeCompare(b.codigo_inventario),
    );

  const equiposSinUso = todosEquiposStats
    .filter((e) => e.usos === 0 && esEquipoOperativo(e.estadoActual) && !e.ocultoCatalogo)
    .map((e) => ({
      id_equipo: e.id_equipo,
      codigo_inventario: e.codigo_inventario,
      categoria: e.categoria,
      marca_modelo: e.marca_modelo,
      estadoActual: e.estadoActual,
    }))
    .sort((a, b) => a.codigo_inventario.localeCompare(b.codigo_inventario));

  const equiposConObservaciones = todosEquiposStats
    .filter((e) => e.obsCount > 0 || e.estadoActual === 'En mantenimiento')
    .map((e) => ({
      id_equipo: e.id_equipo,
      codigo_inventario: e.codigo_inventario,
      categoria: e.categoria,
      marca_modelo: e.marca_modelo,
      estadoActual: e.estadoActual,
      observacionesCount: e.obsCount,
      ultimaNota: e.ultimaNota,
    }))
    .sort((a, b) => b.observacionesCount - a.observacionesCount);

  return {
    totalSolicitudes,
    prestamosEfectivos,
    entregasEquipos,
    reservadosPendientes,
    noPresentados,
    cancelados,
    tasaAusenciaPct: totalSolicitudes > 0 ? Math.round((noPresentados / totalSolicitudes) * 100) : 0,
    tasaCancelacionPct: totalSolicitudes > 0 ? Math.round((cancelados / totalSolicitudes) * 100) : 0,
    horasTotales: Number((minutosTotales / 60).toFixed(1)),
    duracionPromedioMin: prestamosEfectivos > 0 ? Math.round(minutosTotales / prestamosEfectivos) : 0,
    devolucionesEvaluadas,
    devolucionesATiempo,
    devolucionesTarde,
    puntualidadPct:
      devolucionesEvaluadas > 0 ? Math.round((devolucionesATiempo / devolucionesEvaluadas) * 100) : null,
    retirosQrCodigo,
    retirosManual,
    porMes,
    porDiaSemana,
    porFranja,
    porCategoria,
    porCurso,
    porRol,
    equiposMasUsados,
    equiposMenosUsados,
    equiposSinUso,
    equiposConObservaciones,
    detalleExportable: detalleExportable.sort((a, b) => b.fecha.localeCompare(a.fecha)),
  };
}

export function exportarEstadisticasExcel(
  stats: EstadisticasPeriodo,
  desde: string,
  hasta: string,
  categoriaNombre: string,
  soloNotebooks = true,
): void {
  const wb = XLSX.utils.book_new();

  // Hoja 1: Resumen KPIs
  const resumenRows = [
    { Indicador: 'Período analizado', Valor: `${formatearFechaCorta(desde)} al ${formatearFechaCorta(hasta)}` },
    { Indicador: 'Categoría filtrada', Valor: categoriaNombre },
    { Indicador: 'Total solicitudes en el período', Valor: stats.totalSolicitudes },
    { Indicador: 'Préstamos efectivos (Devuelto + En Curso)', Valor: stats.prestamosEfectivos },
    { Indicador: 'Equipos entregados (unidades)', Valor: stats.entregasEquipos },
    { Indicador: 'Horas totales de uso', Valor: stats.horasTotales },
    { Indicador: 'Duración promedio por préstamo (min)', Valor: stats.duracionPromedioMin },
    {
      Indicador: 'Puntualidad en devoluciones',
      Valor:
        stats.puntualidadPct !== null
          ? `${stats.puntualidadPct}% (${stats.devolucionesATiempo} a tiempo / ${stats.devolucionesTarde} tarde)`
          : 'Sin datos',
    },
    { Indicador: 'No Presentado (ausencias)', Valor: `${stats.noPresentados} (${stats.tasaAusenciaPct}%)` },
    { Indicador: 'Cancelados', Valor: `${stats.cancelados} (${stats.tasaCancelacionPct}%)` },
    { Indicador: 'Reservas pendientes', Valor: stats.reservadosPendientes },
    { Indicador: 'Retiros por QR / Código', Valor: stats.retirosQrCodigo },
    { Indicador: 'Retiros manuales', Valor: stats.retirosManual },
  ];
  const wsResumen = XLSX.utils.json_to_sheet(resumenRows);
  wsResumen['!cols'] = [{ wch: 42 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  // Hoja 2: Desgloses
  const catRows = stats.porCategoria.map((c) => ({
    Categoría: c.nombre,
    'Equipos entregados': c.usosEquipos,
    'Préstamos distintos': c.prestamosDistintos,
    'Horas acumuladas': c.horas,
    'Con observaciones': c.conObservaciones,
  }));
  const wsCat = XLSX.utils.json_to_sheet(catRows.length > 0 ? catRows : [{ Categoría: 'Sin datos' }]);
  wsCat['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsCat, 'Por Categoria');

  const cursoRows = stats.porCurso.map((c) => ({
    Curso: c.curso,
    'Préstamos efectivos': c.prestamos,
    '% del total': `${c.porcentaje}%`,
    'Equipos entregados': c.equipos,
    'Horas acumuladas': c.horas,
    'No Presentado': c.noPresentados,
  }));
  const wsCurso = XLSX.utils.json_to_sheet(cursoRows.length > 0 ? cursoRows : [{ Curso: 'Sin datos' }]);
  wsCurso['!cols'] = [{ wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, wsCurso, 'Por Curso');

  // Hoja 3: Mensual y Franjas
  const mesRows = stats.porMes.map((m) => ({
    Mes: m.etiqueta,
    'Préstamos efectivos': m.efectivos,
    'Horas de uso': m.horas,
    'No Presentado': m.noPresentados,
    Cancelados: m.cancelados,
  }));
  const wsMes = XLSX.utils.json_to_sheet(mesRows.length > 0 ? mesRows : [{ Mes: 'Sin datos' }]);
  wsMes['!cols'] = [{ wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsMes, 'Evolucion Mensual');

  // Hoja 4: Ranking de equipos
  const rankingBase = soloNotebooks
    ? stats.equiposMenosUsados.filter((e) => esCategoriaNotebook(e.categoria))
    : stats.equiposMenosUsados;
  const eqRows = rankingBase.map((e) => ({
    Código: e.codigo_inventario,
    Categoría: e.categoria,
    'Marca / Modelo': e.marca_modelo,
    'Estado actual': e.estadoActual,
    Usos: e.usos,
    Horas: e.horas,
    'Último uso': e.ultimoUso ?? 'Sin usos',
    'Reservas próximas': e.reservasProximas,
    'Con observaciones': e.observacionesCount,
  }));
  const wsEq = XLSX.utils.json_to_sheet(eqRows.length > 0 ? eqRows : [{ Código: 'Sin datos' }]);
  wsEq['!cols'] = [
    { wch: 14 },
    { wch: 18 },
    { wch: 24 },
    { wch: 18 },
    { wch: 10 },
    { wch: 10 },
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, wsEq, 'Ranking Equipos');

  // Hoja 5: Detalle préstamos
  const detRows = stats.detalleExportable.map((d) => ({
    Fecha: formatearFechaCorta(d.fecha),
    Horario: d.horarioPrevisto,
    Estado: d.estado,
    Usuario: d.usuario,
    DNI: d.dni,
    Curso: d.curso,
    Rol: d.rol,
    Equipos: d.equipos,
    'Devolución real': d.devolucionReal,
    Puntualidad: d.puntualidad,
    'Horas uso': d.horas,
    Observaciones: d.observaciones,
  }));
  const wsDet = XLSX.utils.json_to_sheet(detRows.length > 0 ? detRows : [{ Fecha: 'Sin datos' }]);
  wsDet['!cols'] = [
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 24 },
    { wch: 12 },
    { wch: 12 },
    { wch: 16 },
    { wch: 24 },
    { wch: 14 },
    { wch: 14 },
    { wch: 10 },
    { wch: 36 },
  ];
  XLSX.utils.book_append_sheet(wb, wsDet, 'Detalle Prestamos');

  XLSX.writeFile(wb, `reporte_itu_${desde}_a_${hasta}.xlsx`);
}
