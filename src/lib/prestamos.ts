import { supabase, type Equipo, type Rol } from '@/lib/supabase';

export const LIMITE_NOTEBOOKS = 2;
export const MENSAJE_LIMITE_NOTEBOOKS =
  'Has alcanzado el límite máximo de 2 notebooks simultáneas. Debes devolver una notebook para poder reservar otra.';

const ROLES_EXENTOS = ['Pañol', 'Administrativo'];

export async function verificarYCaducarReservasVencidas(): Promise<number> {
  const { data, error } = await supabase.rpc('cancelar_reservas_vencidas');
  if (error) throw new Error(error.message);
  if (typeof data !== 'number') throw new Error('Respuesta inesperada al caducar reservas');
  return data;
}

export function aplicaLimiteNotebooks(roles: Rol[]): boolean {
  const nombres = roles.map((r) => r.nombre);
  return nombres.includes('Estudiante') && !nombres.some((n) => ROLES_EXENTOS.includes(n));
}

export function esNotebook(equipo: Equipo): boolean {
  return equipo.categorias_equipo?.nombre === 'Notebook';
}

export async function contarNotebooksActivas(idUsuario: string): Promise<number> {
  const { data, error } = await supabase
    .from('detalle_prestamos')
    .select('id_detalle, prestamos!inner(id_usuario, estado), equipos!inner(categorias_equipo!inner(nombre))')
    .eq('prestamos.id_usuario', idUsuario)
    .in('prestamos.estado', ['Reservado', 'En Curso'])
    .eq('equipos.categorias_equipo.nombre', 'Notebook');
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}
