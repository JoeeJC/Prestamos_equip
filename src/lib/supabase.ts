import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  throw new Error('Faltan las variables VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false },
});

export type Rol = {
  id_rol: string;
  nombre: string;
  descripcion: string | null;
};

export type Usuario = {
  id_usuario: string;
  dni: string;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string | null;
  password_hash: string;
  estado: 'Activo' | 'Sancionado' | 'Inactivo';
  roles?: Rol[];
};

export type Categoria = {
  id_categoria: string;
  nombre: string;
  descripcion: string | null;
};

export type Equipo = {
  id_equipo: string;
  id_categoria: string;
  codigo_inventario: string;
  numero_serie: string | null;
  marca_modelo: string | null;
  estado: 'Disponible' | 'Reservado' | 'En préstamo' | 'En mantenimiento' | 'Baja';
  observaciones: string | null;
  categorias_equipo?: Categoria;
};

export type Prestamo = {
  id_prestamo: string;
  id_usuario: string;
  fecha_solicitud: string;
  fecha_prestamo: string;
  hora_inicio_prevista: string;
  hora_fin_prevista: string;
  hora_retiro_real: string | null;
  hora_devolucion_real: string | null;
  estado: 'Reservado' | 'En Curso' | 'Devuelto' | 'Cancelado' | 'No Presentado';
  observaciones_entrega: string | null;
  observaciones_devolucion: string | null;
  usuarios?: Pick<Usuario, 'id_usuario' | 'dni' | 'nombre' | 'apellido'>;
};

export type DetallePrestamo = {
  id_detalle: string;
  id_prestamo: string;
  id_equipo: string;
  estado_salida: string | null;
  estado_devolucion: string | null;
  equipos?: Equipo;
};
