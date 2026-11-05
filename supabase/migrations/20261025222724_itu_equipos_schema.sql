/*
# ITU Equipos - Schema inicial

1. Propósito
Sistema de gestión de préstamos y reservas de equipos de la universidad ITU.
Permite a estudiantes/profesores/administrativos reservar equipos (notebooks, routers,
cables, zapatillas, TVs) por bloques de hasta 5 horas, y al personal de pañol entregar
y recibir esos equipos registrando su estado físico.

2. Modelo de datos (multi-tenant simple, sin auth.users)
- `usuarios`: personas del sistema (legajo único, nombre, apellido, email, teléfono,
  password_hash, estado). El login se simula con legajo + password en texto (demo).
- `roles`: catálogo de roles (Estudiante, Profesor Adjunto, Administrativo, Pañol).
- `usuario_roles`: tabla intermedia N:M entre usuarios y roles (multi-rol simultáneo).
- `categorias_equipo`: catálogo de categorías de equipo.
- `equipos`: inventario de equipos, cada uno con código de inventario único, serie,
  marca/modelo, estado y observaciones.
- `prestamos`: tabla unificada de reservas y préstamos del día (máx 5 horas). Contiene
  fechas y horas previstas y reales, estado y observaciones de entrega/devolución.
- `detalle_prestamos`: equipos individuales incluidos en un préstamo, con estado de
  salida y de devolución.

3. Seguridad (RLS)
- App de demostración sin pantalla de login de Supabase Auth (el login es por legajo
  simulado). Se habilita RLS y se permite CRUD a anon y authenticated para que el
  cliente con anon key pueda operar toda la lógica desde el navegador.
- Las políticas son abiertas (USING true) porque los datos son intencionalmente
  compartidos para la demo académica.

4. Notas
- Los timestamps usan timestamptz con default now().
- Se agregan índices en columnas de búsqueda frecuente (legajo, codigo_inventario,
  id_usuario, id_prestamo, fecha_prestamo, estado).
*/

-- =========================================
-- Roles
-- =========================================
CREATE TABLE IF NOT EXISTS roles (
  id_rol        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        text NOT NULL UNIQUE,
  descripcion   text,
  created_at    timestamptz DEFAULT now()
);

-- =========================================
-- Usuarios
-- =========================================
CREATE TABLE IF NOT EXISTS usuarios (
  id_usuario    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legajo        text NOT NULL UNIQUE,
  nombre        text NOT NULL,
  apellido      text NOT NULL,
  email         text NOT NULL UNIQUE,
  telefono      text,
  password_hash text NOT NULL,
  estado        text NOT NULL DEFAULT 'Activo'
                CHECK (estado IN ('Activo','Sancionado','Inactivo')),
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_legajo ON usuarios(legajo);

-- =========================================
-- Usuario <-> Roles (N:M)
-- =========================================
CREATE TABLE IF NOT EXISTS usuario_roles (
  id_usuario uuid NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
  id_rol     uuid NOT NULL REFERENCES roles(id_rol) ON DELETE CASCADE,
  PRIMARY KEY (id_usuario, id_rol)
);

-- =========================================
-- Categorías de equipo
-- =========================================
CREATE TABLE IF NOT EXISTS categorias_equipo (
  id_categoria uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre       text NOT NULL UNIQUE,
  descripcion  text,
  created_at   timestamptz DEFAULT now()
);

-- =========================================
-- Equipos
-- =========================================
CREATE TABLE IF NOT EXISTS equipos (
  id_equipo         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_categoria      uuid NOT NULL REFERENCES categorias_equipo(id_categoria) ON DELETE RESTRICT,
  codigo_inventario text NOT NULL UNIQUE,
  numero_serie      text,
  marca_modelo      text,
  estado            text NOT NULL DEFAULT 'Disponible'
                    CHECK (estado IN ('Disponible','Reservado','En préstamo','En mantenimiento','Baja')),
  observaciones     text,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equipos_id_categoria ON equipos(id_categoria);
CREATE INDEX IF NOT EXISTS idx_equipos_codigo_inventario ON equipos(codigo_inventario);
CREATE INDEX IF NOT EXISTS idx_equipos_estado ON equipos(estado);

-- =========================================
-- Préstamos (reservas + préstamos del día)
-- =========================================
CREATE TABLE IF NOT EXISTS prestamos (
  id_prestamo              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario               uuid NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
  fecha_solicitud          timestamptz NOT NULL DEFAULT now(),
  fecha_prestamo           date NOT NULL,
  hora_inicio_prevista     time NOT NULL,
  hora_fin_prevista         time NOT NULL,
  hora_retiro_real         timestamptz,
  hora_devolucion_real     timestamptz,
  estado                   text NOT NULL DEFAULT 'Reservado'
                           CHECK (estado IN ('Reservado','En Curso','Devuelto','Cancelado','No Presentado')),
  observaciones_entrega    text,
  observaciones_devolucion text,
  created_at               timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prestamos_id_usuario ON prestamos(id_usuario);
CREATE INDEX IF NOT EXISTS idx_prestamos_fecha_prestamo ON prestamos(fecha_prestamo);
CREATE INDEX IF NOT EXISTS idx_prestamos_estado ON prestamos(estado);

-- Validación: hora fin > hora inicio (bloques del mismo día, máx 5 horas)
ALTER TABLE prestamos
  ADD CONSTRAINT chk_horas_previstas
  CHECK (hora_fin_prevista > hora_inicio_prevista);

-- =========================================
-- Detalle de préstamos (equipos por préstamo)
-- =========================================
CREATE TABLE IF NOT EXISTS detalle_prestamos (
  id_detalle        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_prestamo       uuid NOT NULL REFERENCES prestamos(id_prestamo) ON DELETE CASCADE,
  id_equipo         uuid NOT NULL REFERENCES equipos(id_equipo) ON DELETE RESTRICT,
  estado_salida     text,
  estado_devolucion text,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (id_prestamo, id_equipo)
);

CREATE INDEX IF NOT EXISTS idx_detalle_id_prestamo ON detalle_prestamos(id_prestamo);
CREATE INDEX IF NOT EXISTS idx_detalle_id_equipo ON detalle_prestamos(id_equipo);

-- =========================================
-- RLS: habilitar en todas las tablas
-- =========================================
ALTER TABLE roles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_roles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias_equipo ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE prestamos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_prestamos ENABLE ROW LEVEL SECURITY;

-- =========================================
-- Grants (anon + authenticated = app demo sin Supabase Auth)
-- =========================================
GRANT SELECT, INSERT, UPDATE, DELETE ON roles TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON usuarios TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON usuario_roles TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON categorias_equipo TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON equipos TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON prestamos TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON detalle_prestamos TO anon, authenticated;

-- =========================================
-- Políticas (demo abierta a anon + authenticated)
-- =========================================
CREATE POLICY "roles_all"             ON roles             FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "usuarios_all"          ON usuarios          FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "usuario_roles_all"     ON usuario_roles    FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "categorias_all"       ON categorias_equipo FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "equipos_all"           ON equipos          FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "prestamos_all"         ON prestamos        FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "detalle_prestamos_all" ON detalle_prestamos FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
