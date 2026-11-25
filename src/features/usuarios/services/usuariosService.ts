import { supabase } from '@/services/supabaseClient';
import type { Rol, Usuario } from '@/types/database';
import { fechaLocalISO } from '@/utils/fechas';

export const CURSOS_OPCIONES = ['1°', '2°', '3°', 'Egresado'] as const;

export const MOTIVOS_BAJA = [
  'Graduado / Egresado',
  'Jubilado',
  'Cambio de institución / Abandono',
  'Fin de contrato / Pasantía',
  'Otro',
];

export type UsuarioAdmin = Usuario & {
  roles: Rol[];
};

export function diasRestantesBaja(fechaBaja?: string | null): number | null {
  if (!fechaBaja) return null;
  const [yH, mH, dH] = fechaLocalISO().split('-').map(Number);
  const [yB, mB, dB] = fechaBaja.split('-').map(Number);
  const hoyUtc = Date.UTC(yH, mH - 1, dH);
  const bajaUtc = Date.UTC(yB, mB - 1, dB);
  return Math.round((bajaUtc - hoyUtc) / (1000 * 60 * 60 * 24));
}

export async function cargarRoles(): Promise<Rol[]> {
  const { data, error } = await supabase.from('roles').select('*').order('nombre');
  if (error) throw new Error(error.message);
  return (data ?? []) as Rol[];
}

export async function listarUsuariosAdmin(token: string): Promise<UsuarioAdmin[]> {
  const { data, error } = await supabase.rpc('admin_listar_usuarios', { p_token: token });
  if (error) throw new Error(error.message);
  return (data ?? []) as UsuarioAdmin[];
}

export async function depurarBajasVencidas(token: string): Promise<number> {
  const { data, error } = await supabase.rpc('admin_depurar_bajas_vencidas', { p_token: token });
  if (error) throw new Error(error.message);
  return typeof data === 'number' ? data : 0;
}

export async function crearUsuarioAdmin(
  token: string,
  payload: {
    dni: string;
    nombre: string;
    apellido: string;
    email: string;
    telefono: string;
    curso: string;
    password: string;
    estado: Usuario['estado'];
    roles: string[];
  },
): Promise<string> {
  const { data, error } = await supabase.rpc('admin_crear_usuario', {
    p_token: token,
    p_dni: payload.dni,
    p_nombre: payload.nombre,
    p_apellido: payload.apellido,
    p_email: payload.email,
    p_telefono: payload.telefono,
    p_curso: payload.curso,
    p_password: payload.password,
    p_estado: payload.estado,
    p_roles: payload.roles,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function actualizarUsuarioAdmin(
  token: string,
  idUsuario: string,
  payload: {
    dni: string;
    nombre: string;
    apellido: string;
    email: string;
    telefono: string;
    curso: string;
    estado: Usuario['estado'];
    roles: string[];
  },
): Promise<void> {
  const { error } = await supabase.rpc('admin_actualizar_usuario', {
    p_token: token,
    p_id_usuario: idUsuario,
    p_dni: payload.dni,
    p_nombre: payload.nombre,
    p_apellido: payload.apellido,
    p_email: payload.email,
    p_telefono: payload.telefono,
    p_curso: payload.curso,
    p_estado: payload.estado,
    p_roles: payload.roles,
  });
  if (error) throw new Error(error.message);
}

export async function programarBajaUsuario(
  token: string,
  idUsuario: string,
  dias: number,
  motivo: string,
): Promise<'eliminado' | 'programado'> {
  const { data, error } = await supabase.rpc('admin_programar_baja_usuario', {
    p_token: token,
    p_id_usuario: idUsuario,
    p_dias: dias,
    p_motivo: motivo,
  });
  if (error) throw new Error(error.message);
  return data === 'eliminado' ? 'eliminado' : 'programado';
}

export async function cancelarBajaUsuario(token: string, idUsuario: string): Promise<void> {
  const { error } = await supabase.rpc('admin_cancelar_baja_usuario', {
    p_token: token,
    p_id_usuario: idUsuario,
  });
  if (error) throw new Error(error.message);
}

export async function restablecerPasswordUsuarioAdmin(
  token: string,
  idUsuario: string,
  passwordNueva?: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_restablecer_password_usuario', {
    p_token: token,
    p_id_usuario: idUsuario,
    p_password_nueva: passwordNueva ?? null,
  });
  if (error) throw new Error(error.message);
}
