import { supabase, type Equipo, type Rol } from '@/lib/supabase';

const CLAVE_LIMITE_NOTEBOOKS = 'limite_notebooks_alumno';
const ROLES_CON_CONFIGURACION = ['Pañol', 'Administrativo'];
const ROLES_SIN_LIMITE = ['Pañol', 'Administrativo', 'Profesor Adjunto'];

export type CupoNotebooks = { limite: number; activas: number };

export async function verificarYCaducarReservasVencidas(): Promise<number> {
  const { data, error } = await supabase.rpc('cancelar_reservas_vencidas');
  if (error) throw new Error(error.message);
  if (typeof data !== 'number') throw new Error('Respuesta inesperada al caducar reservas');
  return data;
}

export function aplicaLimiteNotebooks(roles: Rol[]): boolean {
  const nombres = roles.map((r) => r.nombre);
  return nombres.includes('Estudiante') && !nombres.some((n) => ROLES_SIN_LIMITE.includes(n));
}

export function puedeConfigurarLimite(roles: Rol[]): boolean {
  return roles.some((r) => ROLES_CON_CONFIGURACION.includes(r.nombre));
}

export function mensajeLimiteNotebooks(limite: number): string {
  return `Has alcanzado el límite máximo de ${limite} notebooks simultáneas. Debes devolver una notebook para poder reservar otra.`;
}

export function esNotebook(equipo: Equipo): boolean {
  return equipo.categorias_equipo?.nombre === 'Notebook';
}

export async function obtenerLimiteNotebooks(): Promise<number> {
  const { data, error } = await supabase
    .from('configuracion_sistema')
    .select('valor')
    .eq('clave', CLAVE_LIMITE_NOTEBOOKS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const limite = Number(data?.valor);
  if (!Number.isInteger(limite) || limite < 1) {
    throw new Error('El límite de notebooks no está configurado correctamente');
  }
  return limite;
}

async function contarNotebooksActivas(idUsuario: string): Promise<number> {
  const { data, error } = await supabase
    .from('detalle_prestamos')
    .select('id_detalle, prestamos!inner(id_usuario, estado), equipos!inner(categorias_equipo!inner(nombre))')
    .eq('prestamos.id_usuario', idUsuario)
    .in('prestamos.estado', ['Reservado', 'En Curso'])
    .eq('equipos.categorias_equipo.nombre', 'Notebook');
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

export async function cargarCupoNotebooks(idUsuario: string): Promise<CupoNotebooks> {
  const [limite, activas] = await Promise.all([
    obtenerLimiteNotebooks(),
    contarNotebooksActivas(idUsuario),
  ]);
  return { limite, activas };
}

export async function actualizarLimiteNotebooks(
  idUsuario: string,
  password: string,
  valor: number,
): Promise<number> {
  const { data, error } = await supabase.rpc('actualizar_limite_notebooks', {
    p_id_usuario: idUsuario,
    p_password: password,
    p_valor: valor,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== 'number') throw new Error('Respuesta inesperada al guardar el límite');
  return data;
}
