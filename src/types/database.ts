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
  curso?: string | null;
  estado: 'Activo' | 'Sancionado' | 'Inactivo';
  debe_cambiar_password?: boolean;
  fecha_baja_programada?: string | null;
  motivo_baja?: string | null;
  roles?: Rol[];
};

export type Categoria = {
  id_categoria: string;
  nombre: string;
  descripcion: string | null;
  limite_alumnos: number | null;
};

export type Equipo = {
  id_equipo: string;
  id_categoria: string;
  codigo_inventario: string;
  numero_serie: string | null;
  marca_modelo: string | null;
  estado: 'Disponible' | 'Reservado' | 'En préstamo' | 'En mantenimiento' | 'Baja';
  oculto_catalogo?: boolean;
  observaciones: string | null;
  categorias_equipo?: Categoria;
};

export type FranjaRetiro = {
  id: string;
  etiqueta: string;
  retiro_desde: string;
  retiro_hasta: string;
  hora_clase: string;
};

export type ConfiguracionHorarios = {
  id: number;
  franjas_activas: boolean;
  tolerancia_retiro_min: number;
  hora_cierre_devolucion: string;
  dias_anticipacion_max: number;
  permitir_fines_de_semana: boolean;
  franjas: FranjaRetiro[];
};

export type Prestamo = {
  id_prestamo: string;
  id_usuario: string;
  fecha_solicitud: string;
  fecha_prestamo: string;
  hora_inicio_prevista: string;
  hora_fin_prevista: string;
  retiro_desde?: string | null;
  retiro_hasta?: string | null;
  hora_retiro_real: string | null;
  hora_devolucion_real: string | null;
  estado: 'Reservado' | 'En Curso' | 'Devuelto' | 'Cancelado' | 'No Presentado';
  codigo_retiro?: string | null;
  metodo_entrega?: 'manual' | 'qr' | 'codigo' | null;
  metodo_devolucion?: 'manual' | 'qr' | 'codigo' | null;
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
