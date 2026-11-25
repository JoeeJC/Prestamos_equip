/*
# ITU Equipos - Script SQL completo de la base de datos
# Estado final consolidado (PostgreSQL nativo)

Este script contiene la estructura EXACTA de la base de datos del sistema
ITU Equipos tal como está en producción: tablas, relaciones, restricciones,
índices, RLS, grants y políticas.

Es idempotente: puede ejecutarse completo sobre una base vacía o ya existente
(usando IF NOT EXISTS y DROP ... IF EXISTS donde corresponde).

------------------------------------------------------------------------------
1. MODELO DE DATOS
------------------------------------------------------------------------------
- `usuarios`            Personas del sistema. Identificadas por DNI (único).
- `roles`               Catálogo de roles (Estudiante, Profesor Adjunto,
                       Administrativo, Pañol).
- `usuario_roles`       Tabla intermedia N:M. Una persona puede tener varios
                       roles simultáneos (ej. Estudiante + Profesor Adjunto).
- `categorias_equipo`   Categorías de inventario (Notebook, Router, Cable,
                       Zapatilla, TV).
- `equipos`             Inventario físico. Cada equipo tiene un código de
                       inventario único, serie, marca/modelo, estado y
                       observaciones.
- `prestamos`           Tabla unificada de reservas y préstamos del día
                       (bloques de máximo 5 horas). Contiene fechas/horas
                       previstas y reales, estado y observaciones.
- `detalle_prestamos`   Equipos individuales incluidos en cada préstamo,
                       con estado de salida y de devolución.

------------------------------------------------------------------------------
2. SEGURIDAD (RLS)
------------------------------------------------------------------------------
- App de demostración: el login se simula con DNI + contraseña (texto plano
  en `password_hash` para fines académicos). No se usa Supabase Auth.
- RLS habilitado en todas las tablas.
- Políticas abiertas a `anon` + `authenticated` porque los datos son
  intencionalmente compartidos para la demo.

------------------------------------------------------------------------------
3. NOTAS
------------------------------------------------------------------------------
- Todas las PK usan UUID con `gen_random_uuid()`.
- Todos los `created_at` son `timestamptz DEFAULT now()`.
- Restricción CHECK en `prestamos` para que la hora de fin sea mayor a la de
  inicio (bloques del mismo día, máximo 5 horas).
- Restricción UNIQUE en `detalle_prestamos (id_prestamo, id_equipo)` para
  evitar duplicar el mismo equipo en un préstamo.
- Índices en columnas de búsqueda frecuente.
*/

-- ============================================================================
-- 1. ROLES
-- ============================================================================
CREATE TABLE IF NOT EXISTS roles (
  id_rol      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      text NOT NULL UNIQUE,
  descripcion text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. USUARIOS (identificados por DNI)
-- ============================================================================
CREATE TABLE IF NOT EXISTS usuarios (
  id_usuario    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dni           text NOT NULL UNIQUE,
  nombre        text NOT NULL,
  apellido      text NOT NULL,
  email         text NOT NULL UNIQUE,
  telefono      text,
  password_hash text NOT NULL,
  estado        text NOT NULL DEFAULT 'Activo'
                CHECK (estado IN ('Activo', 'Sancionado', 'Inactivo')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_dni ON usuarios (dni);

-- ============================================================================
-- 3. USUARIO <-> ROLES (N:M, multi-rol simultáneo)
-- ============================================================================
CREATE TABLE IF NOT EXISTS usuario_roles (
  id_usuario uuid NOT NULL REFERENCES usuarios (id_usuario) ON DELETE CASCADE,
  id_rol     uuid NOT NULL REFERENCES roles (id_rol) ON DELETE CASCADE,
  PRIMARY KEY (id_usuario, id_rol)
);

-- ============================================================================
-- 4. CATEGORÍAS DE EQUIPO
-- ============================================================================
CREATE TABLE IF NOT EXISTS categorias_equipo (
  id_categoria uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre       text NOT NULL UNIQUE,
  descripcion  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 5. EQUIPOS (inventario)
-- ============================================================================
CREATE TABLE IF NOT EXISTS equipos (
  id_equipo         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_categoria      uuid NOT NULL REFERENCES categorias_equipo (id_categoria) ON DELETE RESTRICT,
  codigo_inventario text NOT NULL UNIQUE,
  numero_serie      text,
  marca_modelo      text,
  estado            text NOT NULL DEFAULT 'Disponible'
                    CHECK (estado IN ('Disponible', 'Reservado', 'En préstamo', 'En mantenimiento', 'Baja')),
  observaciones     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_equipos_id_categoria      ON equipos (id_categoria);
CREATE INDEX IF NOT EXISTS idx_equipos_codigo_inventario ON equipos (codigo_inventario);
CREATE INDEX IF NOT EXISTS idx_equipos_estado            ON equipos (estado);

-- ============================================================================
-- 6. PRÉSTAMOS (reservas + préstamos del día, máx 5 horas)
-- ============================================================================
CREATE TABLE IF NOT EXISTS prestamos (
  id_prestamo              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario               uuid NOT NULL REFERENCES usuarios (id_usuario) ON DELETE CASCADE,
  fecha_solicitud          timestamptz NOT NULL DEFAULT now(),
  fecha_prestamo           date NOT NULL,
  hora_inicio_prevista     time NOT NULL,
  hora_fin_prevista        time NOT NULL,
  hora_retiro_real         timestamptz,
  hora_devolucion_real     timestamptz,
  estado                   text NOT NULL DEFAULT 'Reservado'
                           CHECK (estado IN ('Reservado', 'En Curso', 'Devuelto', 'Cancelado', 'No Presentado')),
  observaciones_entrega    text,
  observaciones_devolucion text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prestamos_id_usuario      ON prestamos (id_usuario);
CREATE INDEX IF NOT EXISTS idx_prestamos_fecha_prestamo  ON prestamos (fecha_prestamo);
CREATE INDEX IF NOT EXISTS idx_prestamos_estado          ON prestamos (estado);

-- Restricción: la hora de fin debe ser posterior a la de inicio
ALTER TABLE prestamos
  DROP CONSTRAINT IF EXISTS chk_horas_previstas;
ALTER TABLE prestamos
  ADD CONSTRAINT chk_horas_previstas
  CHECK (hora_fin_prevista > hora_inicio_prevista);

-- ============================================================================
-- 7. DETALLE DE PRÉSTAMOS (equipos por préstamo)
-- ============================================================================
CREATE TABLE IF NOT EXISTS detalle_prestamos (
  id_detalle        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_prestamo       uuid NOT NULL REFERENCES prestamos (id_prestamo) ON DELETE CASCADE,
  id_equipo         uuid NOT NULL REFERENCES equipos (id_equipo) ON DELETE RESTRICT,
  estado_salida     text,
  estado_devolucion text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id_prestamo, id_equipo)
);

CREATE INDEX IF NOT EXISTS idx_detalle_id_prestamo ON detalle_prestamos (id_prestamo);
CREATE INDEX IF NOT EXISTS idx_detalle_id_equipo   ON detalle_prestamos (id_equipo);

-- ============================================================================
-- 8. ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE roles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_roles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias_equipo ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE prestamos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_prestamos ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 9. GRANTS (anon + authenticated: app demo sin Supabase Auth)
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON roles             TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON usuarios          TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON usuario_roles     TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON categorias_equipo TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON equipos           TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON prestamos         TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON detalle_prestamos TO anon, authenticated;

-- ============================================================================
-- 10. POLÍTICAS RLS (demo abierta a anon + authenticated)
-- ============================================================================
DROP POLICY IF EXISTS "roles_all"              ON roles;
CREATE POLICY "roles_all"              ON roles             FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "usuarios_all"           ON usuarios;
CREATE POLICY "usuarios_all"           ON usuarios          FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "usuario_roles_all"      ON usuario_roles;
CREATE POLICY "usuario_roles_all"      ON usuario_roles     FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "categorias_all"        ON categorias_equipo;
CREATE POLICY "categorias_all"        ON categorias_equipo FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "equipos_all"            ON equipos;
CREATE POLICY "equipos_all"            ON equipos           FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "prestamos_all"          ON prestamos;
CREATE POLICY "prestamos_all"          ON prestamos         FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "detalle_prestamos_all"  ON detalle_prestamos;
CREATE POLICY "detalle_prestamos_all"  ON detalle_prestamos FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ============================================================================
-- 11. DATOS DE EJEMPLO (seed)
-- ============================================================================

-- Roles
INSERT INTO roles (nombre, descripcion) VALUES
  ('Estudiante',       'Alumno de la universidad ITU'),
  ('Profesor Adjunto', 'Docente adjunto a cargo de comisiones'),
  ('Administrativo',   'Personal no docente de la universidad'),
  ('Pañol',            'Personal de pañol encargado de entregar/recibir equipos')
ON CONFLICT (nombre) DO NOTHING;

-- Categorías
INSERT INTO categorias_equipo (nombre, descripcion) VALUES
  ('Notebook',  'Laptop para uso académico'),
  ('Router',    'Equipo de red para prácticas'),
  ('Cable',     'Cables de red / alimentación'),
  ('Zapatilla', 'Calzado técnico de laboratorio'),
  ('TV',        'Monitor / TV para aulas')
ON CONFLICT (nombre) DO NOTHING;

-- Usuarios (password_hash en texto plano solo para la demo)
INSERT INTO usuarios (dni, nombre, apellido, email, telefono, password_hash, estado) VALUES
  ('34000001', 'Ana',   'López',      'ana.lopez@itu.edu.ar',      '11-5555-0001', 'demo1234',  'Activo'),
  ('34000002', 'Bruno', 'Martínez',    'bruno.martinez@itu.edu.ar','11-5555-0002', 'demo1234',  'Activo'),
  ('34000003', 'Carla', 'Sosa',        'carla.sosa@itu.edu.ar',    '11-5555-0003', 'demo1234',  'Sancionado'),
  ('34000004', 'Pablo', 'Ríos',        'pablo.rios@itu.edu.ar',    '11-5555-0004', 'demo1234',  'Activo'),
  ('34000005', 'Sofía', 'Núñez',       'sofia.nunez@itu.edu.ar',   '11-5555-0005', 'panol1234', 'Activo'),
  ('34000006', 'Diego', 'Fernández',   'diego.fernandez@itu.edu.ar','11-5555-0006','demo1234',  'Activo')
ON CONFLICT (dni) DO NOTHING;

-- Asignación de roles
-- Ana, Bruno y Carla: Estudiante
INSERT INTO usuario_roles (id_usuario, id_rol)
SELECT u.id_usuario, r.id_rol FROM usuarios u, roles r
WHERE u.dni IN ('34000001','34000002','34000003') AND r.nombre = 'Estudiante'
ON CONFLICT DO NOTHING;

-- Pablo: Estudiante + Profesor Adjunto (multi-rol)
INSERT INTO usuario_roles (id_usuario, id_rol)
SELECT u.id_usuario, r.id_rol FROM usuarios u, roles r
WHERE u.dni = '34000004' AND r.nombre IN ('Estudiante', 'Profesor Adjunto')
ON CONFLICT DO NOTHING;

-- Diego: Administrativo
INSERT INTO usuario_roles (id_usuario, id_rol)
SELECT u.id_usuario, r.id_rol FROM usuarios u, roles r
WHERE u.dni = '34000006' AND r.nombre = 'Administrativo'
ON CONFLICT DO NOTHING;

-- Sofía: Pañol
INSERT INTO usuario_roles (id_usuario, id_rol)
SELECT u.id_usuario, r.id_rol FROM usuarios u, roles r
WHERE u.dni = '34000005' AND r.nombre = 'Pañol'
ON CONFLICT DO NOTHING;

-- Equipos
INSERT INTO equipos (id_categoria, codigo_inventario, numero_serie, marca_modelo, estado, observaciones)
SELECT c.id_categoria, 'NB-001', 'SN-NB-001', 'Lenovo ThinkPad E14', 'Disponible', '8GB RAM, SSD 256GB'
FROM categorias_equipo c WHERE c.nombre = 'Notebook'
ON CONFLICT (codigo_inventario) DO NOTHING;

INSERT INTO equipos (id_categoria, codigo_inventario, numero_serie, marca_modelo, estado, observaciones)
SELECT c.id_categoria, 'NB-002', 'SN-NB-002', 'Dell Latitude 5420', 'Disponible', '16GB RAM, SSD 512GB'
FROM categorias_equipo c WHERE c.nombre = 'Notebook'
ON CONFLICT (codigo_inventario) DO NOTHING;

INSERT INTO equipos (id_categoria, codigo_inventario, numero_serie, marca_modelo, estado, observaciones)
SELECT c.id_categoria, 'NB-003', 'SN-NB-003', 'HP ProBook 450', 'En mantenimiento', 'Pantalla a revisar'
FROM categorias_equipo c WHERE c.nombre = 'Notebook'
ON CONFLICT (codigo_inventario) DO NOTHING;

INSERT INTO equipos (id_categoria, codigo_inventario, numero_serie, marca_modelo, estado, observaciones)
SELECT c.id_categoria, 'RT-001', 'SN-RT-001', 'TP-Link Archer C6', 'Disponible', 'Dual band'
FROM categorias_equipo c WHERE c.nombre = 'Router'
ON CONFLICT (codigo_inventario) DO NOTHING;

INSERT INTO equipos (id_categoria, codigo_inventario, numero_serie, marca_modelo, estado, observaciones)
SELECT c.id_categoria, 'RT-002', 'SN-RT-002', 'Cisco RV130', 'Disponible', NULL
FROM categorias_equipo c WHERE c.nombre = 'Router'
ON CONFLICT (codigo_inventario) DO NOTHING;

INSERT INTO equipos (id_categoria, codigo_inventario, numero_serie, marca_modelo, estado, observaciones)
SELECT c.id_categoria, 'CB-001', 'SN-CB-001', 'Cat6 2m', 'Disponible', 'Cable de red'
FROM categorias_equipo c WHERE c.nombre = 'Cable'
ON CONFLICT (codigo_inventario) DO NOTHING;

INSERT INTO equipos (id_categoria, codigo_inventario, numero_serie, marca_modelo, estado, observaciones)
SELECT c.id_categoria, 'CB-002', 'SN-CB-002', 'Cat6 5m', 'Disponible', 'Cable de red'
FROM categorias_equipo c WHERE c.nombre = 'Cable'
ON CONFLICT (codigo_inventario) DO NOTHING;

INSERT INTO equipos (id_categoria, codigo_inventario, numero_serie, marca_modelo, estado, observaciones)
SELECT c.id_categoria, 'CB-003', 'SN-CB-003', 'HDMI 3m', 'Disponible', 'Cable HDMI'
FROM categorias_equipo c WHERE c.nombre = 'Cable'
ON CONFLICT (codigo_inventario) DO NOTHING;

INSERT INTO equipos (id_categoria, codigo_inventario, numero_serie, marca_modelo, estado, observaciones)
SELECT c.id_categoria, 'ZP-001', 'SN-ZP-001', 'Zapatilla talla 40', 'Disponible', NULL
FROM categorias_equipo c WHERE c.nombre = 'Zapatilla'
ON CONFLICT (codigo_inventario) DO NOTHING;

INSERT INTO equipos (id_categoria, codigo_inventario, numero_serie, marca_modelo, estado, observaciones)
SELECT c.id_categoria, 'ZP-002', 'SN-ZP-002', 'Zapatilla talla 42', 'Baja', 'Suela despegada'
FROM categorias_equipo c WHERE c.nombre = 'Zapatilla'
ON CONFLICT (codigo_inventario) DO NOTHING;

INSERT INTO equipos (id_categoria, codigo_inventario, numero_serie, marca_modelo, estado, observaciones)
SELECT c.id_categoria, 'TV-001', 'SN-TV-001', 'Samsung 55" 4K', 'Disponible', 'Para aula 12'
FROM categorias_equipo c WHERE c.nombre = 'TV'
ON CONFLICT (codigo_inventario) DO NOTHING;

INSERT INTO equipos (id_categoria, codigo_inventario, numero_serie, marca_modelo, estado, observaciones)
SELECT c.id_categoria, 'TV-002', 'SN-TV-002', 'LG 50" FullHD', 'Disponible', NULL
FROM categorias_equipo c WHERE c.nombre = 'TV'
ON CONFLICT (codigo_inventario) DO NOTHING;
