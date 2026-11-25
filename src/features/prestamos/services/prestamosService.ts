import { supabase } from '@/services/supabaseClient';
import type { Categoria, Equipo, Prestamo, Rol } from '@/types/database';

const ROLES_CON_CONFIGURACION = ['Administrativo'];
const ROLES_SIN_LIMITE = ['Administrativo', 'Profesor Adjunto'];
const ESTADOS_ACTIVOS = ['Reservado', 'En Curso'];

export const LIMITE_MIN = 1;
export const LIMITE_MAX = 50;

export type CupoCategoria = {
  id_categoria: string;
  nombre: string;
  limite: number;
  activas: number;
};

export async function verificarYCaducarReservasVencidas(): Promise<number> {
  const { data, error } = await supabase.rpc('cancelar_reservas_vencidas');
  if (error) throw new Error(error.message);
  if (typeof data !== 'number') throw new Error('Respuesta inesperada al caducar reservas');
  return data;
}

export function aplicaLimitesReserva(roles: Rol[]): boolean {
  const nombres = roles.map((r) => r.nombre);
  return nombres.includes('Estudiante') && !nombres.some((n) => ROLES_SIN_LIMITE.includes(n));
}

export function puedeConfigurarLimites(roles: Rol[]): boolean {
  return roles.some((r) => ROLES_CON_CONFIGURACION.includes(r.nombre));
}

export function mensajeLimiteCategoria(cupo: Pick<CupoCategoria, 'nombre' | 'limite'>): string {
  if (cupo.nombre === 'Notebook') {
    return `Has alcanzado el límite máximo de ${cupo.limite} notebooks simultáneas. Debes devolver una notebook para poder reservar otra.`;
  }
  return `Has alcanzado el límite máximo de ${cupo.limite} equipos de la categoría ${cupo.nombre} simultáneos. Debes devolver uno para poder reservar otro.`;
}

export function cupoDeEquipo(cupos: CupoCategoria[], equipo: Equipo): CupoCategoria | undefined {
  return cupos.find((c) => c.id_categoria === equipo.id_categoria);
}

export async function cargarCuposEstudiante(idUsuario: string): Promise<CupoCategoria[]> {
  const [{ data: categorias, error: cErr }, { data: detalles, error: dErr }] = await Promise.all([
    supabase
      .from('categorias_equipo')
      .select('id_categoria, nombre, limite_alumnos')
      .not('limite_alumnos', 'is', null),
    supabase
      .from('detalle_prestamos')
      .select('equipos!inner(id_categoria), prestamos!inner(id_usuario, estado)')
      .eq('prestamos.id_usuario', idUsuario)
      .in('prestamos.estado', ESTADOS_ACTIVOS),
  ]);
  if (cErr) throw new Error(cErr.message);
  if (dErr) throw new Error(dErr.message);

  const activasPorCategoria = new Map<string, number>();
  for (const d of (detalles ?? []) as { equipos: { id_categoria: string } | null }[]) {
    const id = d.equipos?.id_categoria;
    if (!id) continue;
    activasPorCategoria.set(id, (activasPorCategoria.get(id) ?? 0) + 1);
  }

  return (categorias ?? []).map((c: { id_categoria: string; nombre: string; limite_alumnos: number }) => ({
    id_categoria: c.id_categoria,
    nombre: c.nombre,
    limite: c.limite_alumnos,
    activas: activasPorCategoria.get(c.id_categoria) ?? 0,
  }));
}

export async function cargarCategorias(): Promise<Categoria[]> {
  const { data, error } = await supabase
    .from('categorias_equipo')
    .select('*')
    .order('nombre');
  if (error) throw new Error(error.message);
  return (data ?? []) as Categoria[];
}

export async function actualizarLimiteCategoria(
  token: string,
  idCategoria: string,
  limite: number | null,
): Promise<number | null> {
  const { data, error } = await supabase.rpc('actualizar_limite_categoria', {
    p_token: token,
    p_id_categoria: idCategoria,
    p_limite: limite,
  });
  if (error) throw new Error(error.message);
  if (data !== null && typeof data !== 'number') throw new Error('Respuesta inesperada al guardar el límite');
  return data;
}

type PrestamoOrdenable = Pick<
  Prestamo,
  'estado' | 'fecha_prestamo' | 'hora_inicio_prevista' | 'hora_fin_prevista'
>;

function prioridadEstado(estado: Prestamo['estado']): number {
  if (estado === 'En Curso') return 0;
  if (estado === 'Reservado') return 1;
  return 2;
}

export function esPrestamoActivoOPendiente(estado: Prestamo['estado']): boolean {
  return estado === 'En Curso' || estado === 'Reservado';
}

export function ordenarPrestamosPorPrioridad<T extends PrestamoOrdenable>(lista: T[]): T[] {
  return [...lista].sort((a, b) => {
    const prioA = prioridadEstado(a.estado);
    const prioB = prioridadEstado(b.estado);
    if (prioA !== prioB) return prioA - prioB;

    // En Curso: primero los que vencen antes (fecha + hora_fin_prevista ascendente)
    if (prioA === 0) {
      const fechaCmp = a.fecha_prestamo.localeCompare(b.fecha_prestamo);
      if (fechaCmp !== 0) return fechaCmp;
      const finCmp = a.hora_fin_prevista.localeCompare(b.hora_fin_prevista);
      if (finCmp !== 0) return finCmp;
      return a.hora_inicio_prevista.localeCompare(b.hora_inicio_prevista);
    }

    // Reservado: primero los próximos a retirar (fecha + hora_inicio_prevista ascendente)
    if (prioA === 1) {
      const fechaCmp = a.fecha_prestamo.localeCompare(b.fecha_prestamo);
      if (fechaCmp !== 0) return fechaCmp;
      return a.hora_inicio_prevista.localeCompare(b.hora_inicio_prevista);
    }

    // Historial (Devuelto, Cancelado, No Presentado): más reciente primero
    const fechaCmp = b.fecha_prestamo.localeCompare(a.fecha_prestamo);
    if (fechaCmp !== 0) return fechaCmp;
    return b.hora_inicio_prevista.localeCompare(a.hora_inicio_prevista);
  });
}
