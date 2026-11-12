import { supabase, type Categoria, type Equipo, type Rol } from '@/lib/supabase';

const ROLES_CON_CONFIGURACION = ['Pañol', 'Administrativo'];
const ROLES_SIN_LIMITE = ['Pañol', 'Administrativo', 'Profesor Adjunto'];
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
