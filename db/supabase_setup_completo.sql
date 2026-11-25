-- ============================================================================
-- ITU EQUIPOS - SCRIPT CONSOLIDADO PARA SUPABASE.COM (PostgreSQL)
-- Ejecutar completo una sola vez en: Supabase -> SQL Editor -> New query -> Run
-- ============================================================================

-- 0. Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Limpieza de tabla obsoleta de versiones anteriores (si existiera)
DROP TABLE IF EXISTS configuracion_sistema CASCADE;

-- ============================================================================
-- 1. TABLAS BASE
-- ============================================================================

CREATE TABLE IF NOT EXISTS roles (
  id_rol      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      text NOT NULL UNIQUE,
  descripcion text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usuarios (
  id_usuario            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dni                   text NOT NULL UNIQUE,
  nombre                text NOT NULL,
  apellido              text NOT NULL,
  email                 text NOT NULL UNIQUE,
  telefono              text,
  curso                 text
                        CHECK (curso IS NULL OR curso IN ('1°', '2°', '3°', 'Egresado')),
  password_hash         text NOT NULL,
  estado                text NOT NULL DEFAULT 'Activo'
                        CHECK (estado IN ('Activo', 'Sancionado', 'Inactivo')),
  debe_cambiar_password boolean NOT NULL DEFAULT false,
  fecha_baja_programada date,
  motivo_baja           text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_dni   ON usuarios (dni);
CREATE INDEX IF NOT EXISTS idx_usuarios_curso ON usuarios (curso);
CREATE INDEX IF NOT EXISTS idx_usuarios_baja_programada
  ON usuarios (fecha_baja_programada)
  WHERE fecha_baja_programada IS NOT NULL;

CREATE TABLE IF NOT EXISTS usuario_roles (
  id_usuario uuid NOT NULL REFERENCES usuarios (id_usuario) ON DELETE CASCADE,
  id_rol     uuid NOT NULL REFERENCES roles (id_rol) ON DELETE CASCADE,
  PRIMARY KEY (id_usuario, id_rol)
);

CREATE TABLE IF NOT EXISTS sesiones_usuario (
  id_sesion  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL REFERENCES usuarios (id_usuario) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  creado_el  timestamptz NOT NULL DEFAULT now(),
  expira_el  timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE INDEX IF NOT EXISTS idx_sesiones_token ON sesiones_usuario (token);

CREATE TABLE IF NOT EXISTS categorias_equipo (
  id_categoria   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         text NOT NULL UNIQUE,
  descripcion    text,
  limite_alumnos integer DEFAULT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS equipos (
  id_equipo         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_categoria      uuid NOT NULL REFERENCES categorias_equipo (id_categoria) ON DELETE RESTRICT,
  codigo_inventario text NOT NULL UNIQUE,
  numero_serie      text,
  marca_modelo      text,
  estado            text NOT NULL DEFAULT 'Disponible'
                    CHECK (estado IN ('Disponible', 'Reservado', 'En préstamo', 'En mantenimiento', 'Baja')),
  oculto_catalogo   boolean NOT NULL DEFAULT false,
  observaciones     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE equipos ADD COLUMN IF NOT EXISTS oculto_catalogo boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_equipos_id_categoria      ON equipos (id_categoria);
CREATE INDEX IF NOT EXISTS idx_equipos_codigo_inventario ON equipos (codigo_inventario);
CREATE INDEX IF NOT EXISTS idx_equipos_estado            ON equipos (estado);
CREATE UNIQUE INDEX IF NOT EXISTS idx_equipos_numero_serie_unico
  ON equipos (upper(btrim(numero_serie)))
  WHERE numero_serie IS NOT NULL AND btrim(numero_serie) <> '';

CREATE TABLE IF NOT EXISTS prestamos (
  id_prestamo              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario               uuid NOT NULL REFERENCES usuarios (id_usuario) ON DELETE CASCADE,
  fecha_solicitud          timestamptz NOT NULL DEFAULT now(),
  fecha_prestamo           date NOT NULL,
  hora_inicio_prevista     time NOT NULL,
  hora_fin_prevista        time NOT NULL,
  retiro_desde             time,
  retiro_hasta             time,
  hora_retiro_real         timestamptz,
  hora_devolucion_real     timestamptz,
  estado                   text NOT NULL DEFAULT 'Reservado'
                           CHECK (estado IN ('Reservado', 'En Curso', 'Devuelto', 'Cancelado', 'No Presentado')),
  codigo_retiro            text,
  metodo_entrega           text CHECK (metodo_entrega IN ('manual', 'qr', 'codigo')),
  metodo_devolucion        text CHECK (metodo_devolucion IN ('manual', 'qr', 'codigo')),
  observaciones_entrega    text,
  observaciones_devolucion text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prestamos_id_usuario     ON prestamos (id_usuario);
CREATE INDEX IF NOT EXISTS idx_prestamos_fecha_prestamo ON prestamos (fecha_prestamo);
CREATE INDEX IF NOT EXISTS idx_prestamos_estado         ON prestamos (estado);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prestamos_codigo_retiro
  ON prestamos (codigo_retiro)
  WHERE codigo_retiro IS NOT NULL;

ALTER TABLE prestamos DROP CONSTRAINT IF EXISTS chk_horas_previstas;
ALTER TABLE prestamos ADD CONSTRAINT chk_horas_previstas CHECK (hora_fin_prevista > hora_inicio_prevista);

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

CREATE TABLE IF NOT EXISTS configuracion_horarios (
  id                       integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  franjas_activas          boolean NOT NULL DEFAULT true,
  tolerancia_retiro_min    integer NOT NULL DEFAULT 5 CHECK (tolerancia_retiro_min BETWEEN 0 AND 60),
  hora_cierre_devolucion   time NOT NULL DEFAULT '22:00:00',
  dias_anticipacion_max    integer NOT NULL DEFAULT 7 CHECK (dias_anticipacion_max BETWEEN 0 AND 90),
  permitir_fines_de_semana boolean NOT NULL DEFAULT false,
  franjas                  jsonb NOT NULL DEFAULT '[
    {"id":"f-1","etiqueta":"1ª hora (08:00)","retiro_desde":"07:50","retiro_hasta":"08:10","hora_clase":"08:00"},
    {"id":"f-2","etiqueta":"2ª hora (09:30)","retiro_desde":"09:15","retiro_hasta":"09:30","hora_clase":"09:30"},
    {"id":"f-3","etiqueta":"3ª hora (11:00)","retiro_desde":"10:45","retiro_hasta":"11:00","hora_clase":"11:00"},
    {"id":"f-4","etiqueta":"4ª hora (12:30)","retiro_desde":"12:15","retiro_hasta":"12:30","hora_clase":"12:30"},
    {"id":"f-5","etiqueta":"5ª hora (14:00)","retiro_desde":"13:45","retiro_hasta":"14:00","hora_clase":"14:00"},
    {"id":"f-6","etiqueta":"6ª hora (15:30)","retiro_desde":"15:15","retiro_hasta":"15:30","hora_clase":"15:30"},
    {"id":"f-7","etiqueta":"7ª hora (17:00)","retiro_desde":"16:45","retiro_hasta":"17:00","hora_clase":"17:00"},
    {"id":"f-8","etiqueta":"8ª hora (18:30)","retiro_desde":"18:15","retiro_hasta":"18:30","hora_clase":"18:30"},
    {"id":"f-9","etiqueta":"9ª hora (20:00)","retiro_desde":"19:45","retiro_hasta":"20:00","hora_clase":"20:00"}
  ]'::jsonb,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

INSERT INTO configuracion_horarios (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 2. SEGURIDAD (RLS, PERMISOS Y POLÍTICAS)
-- ============================================================================

ALTER TABLE roles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_roles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sesiones_usuario  ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias_equipo ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE prestamos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_prestamos ENABLE ROW LEVEL SECURITY;

-- Permisos de tablas
GRANT SELECT, INSERT, UPDATE, DELETE ON roles             TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON equipos           TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON prestamos         TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON detalle_prestamos TO anon, authenticated;

-- Categorías: límite de alumnos solo modificable por RPC segura
GRANT SELECT ON categorias_equipo TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON categorias_equipo FROM anon, authenticated;
GRANT INSERT (nombre, descripcion) ON categorias_equipo TO anon, authenticated;
GRANT UPDATE (nombre, descripcion) ON categorias_equipo TO anon, authenticated;

-- Usuarios: nunca exponer password_hash ni permitir escritura pública directa
REVOKE ALL ON usuarios FROM anon, authenticated;
GRANT SELECT (id_usuario, dni, nombre, apellido, email, estado, curso, fecha_baja_programada, motivo_baja) ON usuarios TO anon, authenticated;

-- Usuario Roles: solo lectura (para evitar autoasignación de roles)
GRANT SELECT ON usuario_roles TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON usuario_roles FROM anon, authenticated;

-- Sesiones: acceso 100% bloqueado desde API directa (solo vía RPC)
REVOKE ALL ON sesiones_usuario FROM anon, authenticated;

-- Políticas RLS
DROP POLICY IF EXISTS "roles_all"             ON roles;
CREATE POLICY "roles_all"             ON roles             FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "usuarios_all"          ON usuarios;
CREATE POLICY "usuarios_all"          ON usuarios          FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "usuario_roles_all"     ON usuario_roles;
CREATE POLICY "usuario_roles_all"     ON usuario_roles     FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "categorias_all"        ON categorias_equipo;
CREATE POLICY "categorias_all"        ON categorias_equipo FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "equipos_all"           ON equipos;
CREATE POLICY "equipos_all"           ON equipos           FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "prestamos_all"         ON prestamos;
CREATE POLICY "prestamos_all"         ON prestamos         FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "detalle_prestamos_all" ON detalle_prestamos;
CREATE POLICY "detalle_prestamos_all" ON detalle_prestamos FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE configuracion_horarios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON configuracion_horarios FROM anon, authenticated;
GRANT SELECT ON configuracion_horarios TO anon, authenticated;
DROP POLICY IF EXISTS "configuracion_horarios_select" ON configuracion_horarios;
CREATE POLICY "configuracion_horarios_select" ON configuracion_horarios FOR SELECT TO anon, authenticated USING (true);

-- ============================================================================
-- 3. FUNCIONES RPC Y TRIGGERS
-- ============================================================================

-- Helper interno de datos de sesión (sin password_hash)
CREATE OR REPLACE FUNCTION public.datos_sesion(p_id_usuario uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'usuario', (
      SELECT jsonb_build_object(
        'id_usuario', u.id_usuario,
        'dni', u.dni,
        'nombre', u.nombre,
        'apellido', u.apellido,
        'email', u.email,
        'telefono', u.telefono,
        'curso', u.curso,
        'estado', u.estado,
        'debe_cambiar_password', COALESCE(u.debe_cambiar_password, false),
        'fecha_baja_programada', u.fecha_baja_programada,
        'motivo_baja', u.motivo_baja
      )
      FROM usuarios u
      WHERE u.id_usuario = p_id_usuario
    ),
    'roles', COALESCE((
      SELECT jsonb_agg(to_jsonb(r))
      FROM usuario_roles ur
      JOIN roles r ON r.id_rol = ur.id_rol
      WHERE ur.id_usuario = p_id_usuario
    ), '[]'::jsonb)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.datos_sesion(uuid) FROM PUBLIC, anon, authenticated;

-- Login con DNI + contraseña cifrada y emisión de token de sesión (7 días)
CREATE OR REPLACE FUNCTION public.iniciar_sesion(p_dni text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_usuario usuarios%ROWTYPE;
  v_token text;
BEGIN
  SELECT * INTO v_usuario FROM usuarios WHERE dni = btrim(p_dni);
  IF NOT FOUND OR extensions.crypt(p_password, v_usuario.password_hash) <> v_usuario.password_hash THEN
    RAISE EXCEPTION 'DNI o contraseña incorrectos';
  END IF;

  IF v_usuario.estado = 'Inactivo' THEN
    RAISE EXCEPTION 'Usuario inactivo';
  END IF;

  DELETE FROM sesiones_usuario
  WHERE id_usuario = v_usuario.id_usuario AND expira_el <= NOW();

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO sesiones_usuario (id_usuario, token) VALUES (v_usuario.id_usuario, v_token);

  RETURN jsonb_build_object('token', v_token) || public.datos_sesion(v_usuario.id_usuario);
END;
$$;

-- Restaurar sesión desde token guardado en localStorage
CREATE OR REPLACE FUNCTION public.restaurar_sesion(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id_usuario uuid;
BEGIN
  SELECT s.id_usuario INTO v_id_usuario
  FROM sesiones_usuario s
  JOIN usuarios u ON u.id_usuario = s.id_usuario
  WHERE s.token = p_token
    AND s.expira_el > NOW()
    AND u.estado <> 'Inactivo';

  IF v_id_usuario IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object('token', p_token) || public.datos_sesion(v_id_usuario);
END;
$$;

-- Cerrar sesión invalidando el token
CREATE OR REPLACE FUNCTION public.cerrar_sesion(p_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM sesiones_usuario WHERE token = p_token;
$$;

-- Actualizar límite de categoría (solo Administrativo con token válido)
CREATE OR REPLACE FUNCTION public.actualizar_limite_categoria(
  p_token text,
  p_id_categoria uuid,
  p_limite integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_limite IS NOT NULL AND (p_limite < 1 OR p_limite > 50) THEN
    RAISE EXCEPTION 'El límite debe estar entre 1 y 50, o quedar sin límite';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM sesiones_usuario s
    JOIN usuarios u ON u.id_usuario = s.id_usuario
    JOIN usuario_roles ur ON ur.id_usuario = u.id_usuario
    JOIN roles r ON r.id_rol = ur.id_rol
    WHERE s.token = p_token
      AND s.expira_el > NOW()
      AND u.estado <> 'Inactivo'
      AND r.nombre = 'Administrativo'
  ) THEN
    RAISE EXCEPTION 'No tenés permisos para modificar el límite o tu sesión expiró';
  END IF;

  UPDATE categorias_equipo
  SET limite_alumnos = p_limite
  WHERE id_categoria = p_id_categoria;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La categoría indicada no existe';
  END IF;

  RETURN p_limite;
END;
$$;

-- Caducar reservas vencidas automáticamente (hora Argentina + tolerancia)
CREATE OR REPLACE FUNCTION public.cancelar_reservas_vencidas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ahora      timestamp := now() AT TIME ZONE 'America/Argentina/Buenos_Aires';
  v_tolerancia integer := 5;
  v_total      integer;
BEGIN
  SELECT COALESCE(tolerancia_retiro_min, 5)
  INTO v_tolerancia
  FROM public.configuracion_horarios
  WHERE id = 1;

  WITH vencidos AS (
    SELECT p.id_prestamo
    FROM prestamos p
    WHERE p.estado = 'Reservado'
      AND (
        CASE
          WHEN p.retiro_hasta IS NOT NULL
            THEN ((p.fecha_prestamo + p.retiro_hasta) + make_interval(mins => v_tolerancia)) < v_ahora
          ELSE (p.fecha_prestamo + p.hora_fin_prevista) < v_ahora
        END
      )
  ),
  equipos_liberables AS (
    SELECT DISTINCT d.id_equipo
    FROM detalle_prestamos d
    JOIN vencidos v ON v.id_prestamo = d.id_prestamo
    WHERE NOT EXISTS (
      SELECT 1
      FROM detalle_prestamos d2
      JOIN prestamos p2 ON p2.id_prestamo = d2.id_prestamo
      WHERE d2.id_equipo = d.id_equipo
        AND p2.estado IN ('Reservado', 'En Curso')
        AND p2.id_prestamo NOT IN (SELECT id_prestamo FROM vencidos)
    )
  ),
  equipos_actualizados AS (
    UPDATE equipos e
    SET estado = 'Disponible'
    FROM equipos_liberables l
    WHERE e.id_equipo = l.id_equipo
      AND e.estado = 'Reservado'
    RETURNING e.id_equipo
  ),
  prestamos_cancelados AS (
    UPDATE prestamos p
    SET estado = 'No Presentado'
    FROM vencidos v
    WHERE p.id_prestamo = v.id_prestamo
    RETURNING p.id_prestamo
  )
  SELECT count(*)::integer INTO v_total FROM prestamos_cancelados;

  RETURN COALESCE(v_total, 0);
END;
$$;

-- Trigger: liberar equipos automáticamente al cancelar o marcar No Presentado
CREATE OR REPLACE FUNCTION public.liberar_equipos_al_cancelar_prestamo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.estado IN ('Cancelado', 'No Presentado')
     AND OLD.estado IN ('Reservado', 'En Curso') THEN
    UPDATE equipos e
    SET estado = 'Disponible'
    FROM detalle_prestamos d
    WHERE d.id_prestamo = NEW.id_prestamo
      AND e.id_equipo = d.id_equipo
      AND (
        e.estado = 'Reservado'
        OR (
          e.estado = 'En préstamo'
          AND OLD.estado = 'En Curso'
          AND NOT EXISTS (
            SELECT 1
            FROM detalle_prestamos d2
            JOIN prestamos p2 ON p2.id_prestamo = d2.id_prestamo
            WHERE d2.id_equipo = e.id_equipo
              AND p2.id_prestamo <> NEW.id_prestamo
              AND p2.estado = 'En Curso'
          )
        )
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_liberar_equipos_al_cancelar_prestamo ON prestamos;
CREATE TRIGGER trg_liberar_equipos_al_cancelar_prestamo
AFTER UPDATE OF estado ON prestamos
FOR EACH ROW
WHEN (OLD.estado IS DISTINCT FROM NEW.estado)
EXECUTE FUNCTION public.liberar_equipos_al_cancelar_prestamo();

-- Triggers de validación de reservas y detalles (anticipación, fines de semana, solapamiento y cupo)
CREATE OR REPLACE FUNCTION public.validar_prestamo_antes_de_crear()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hoy            date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_usuario_estado text;
  v_dias_max       integer := 7;
  v_permitir_finde boolean := false;
  v_cierre         time := '22:00:00';
BEGIN
  SELECT estado INTO v_usuario_estado
  FROM public.usuarios
  WHERE id_usuario = NEW.id_usuario;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El usuario indicado no existe';
  END IF;

  IF v_usuario_estado IN ('Sancionado', 'Inactivo') THEN
    RAISE EXCEPTION 'Tu usuario no está habilitado para realizar reservas o préstamos';
  END IF;

  IF NEW.estado = 'Reservado' THEN
    SELECT
      COALESCE(dias_anticipacion_max, 7),
      COALESCE(permitir_fines_de_semana, false),
      COALESCE(hora_cierre_devolucion, '22:00:00'::time)
    INTO v_dias_max, v_permitir_finde, v_cierre
    FROM public.configuracion_horarios
    WHERE id = 1;

    IF NEW.fecha_prestamo < v_hoy THEN
      RAISE EXCEPTION 'No podés reservar para una fecha anterior a hoy';
    END IF;

    IF NEW.fecha_prestamo > (v_hoy + v_dias_max) THEN
      RAISE EXCEPTION 'Solo podés reservar con hasta % día(s) de anticipación', v_dias_max;
    END IF;

    IF NOT v_permitir_finde AND EXTRACT(ISODOW FROM NEW.fecha_prestamo) IN (6, 7) THEN
      RAISE EXCEPTION 'No se realizan reservas los sábados ni domingos';
    END IF;

    IF NEW.hora_inicio_prevista >= v_cierre THEN
      RAISE EXCEPTION 'El horario de inicio debe ser anterior al cierre (%)', to_char(v_cierre, 'HH24:MI');
    END IF;

    IF NEW.hora_fin_prevista > v_cierre THEN
      RAISE EXCEPTION 'La hora de devolución no puede superar las % hs', to_char(v_cierre, 'HH24:MI');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_prestamo_antes_de_crear ON prestamos;
CREATE TRIGGER trg_validar_prestamo_antes_de_crear
BEFORE INSERT ON prestamos
FOR EACH ROW
EXECUTE FUNCTION public.validar_prestamo_antes_de_crear();

CREATE OR REPLACE FUNCTION public.validar_detalle_prestamo_antes_de_crear()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hoy            date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_prestamo       public.prestamos%ROWTYPE;
  v_eq_estado      text;
  v_eq_codigo      text;
  v_eq_oculto      boolean;
  v_id_categoria   uuid;
  v_cat_nombre     text;
  v_limite         integer;
  v_es_limitado    boolean := false;
  v_activas        integer := 0;
BEGIN
  SELECT * INTO v_prestamo
  FROM public.prestamos
  WHERE id_prestamo = NEW.id_prestamo;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El préstamo asociado no existe';
  END IF;

  SELECT estado, codigo_inventario, id_categoria, COALESCE(oculto_catalogo, false)
  INTO v_eq_estado, v_eq_codigo, v_id_categoria, v_eq_oculto
  FROM public.equipos
  WHERE id_equipo = NEW.id_equipo
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El equipo seleccionado no existe';
  END IF;

  IF v_eq_estado IN ('En mantenimiento', 'Baja') THEN
    RAISE EXCEPTION 'El equipo % no está operativo (%)', v_eq_codigo, v_eq_estado;
  END IF;

  IF v_prestamo.estado = 'Reservado' AND v_eq_oculto THEN
    RAISE EXCEPTION 'El equipo % está oculto del catálogo y no puede reservarse por este medio', v_eq_codigo;
  END IF;

  IF v_prestamo.estado = 'En Curso' AND v_eq_estado = 'En préstamo' THEN
    RAISE EXCEPTION 'El equipo % ya se encuentra en préstamo', v_eq_codigo;
  END IF;

  IF v_prestamo.estado = 'Reservado' AND v_eq_estado = 'En préstamo' AND v_prestamo.fecha_prestamo <= v_hoy THEN
    RAISE EXCEPTION 'El equipo % está actualmente en préstamo y aún no fue devuelto', v_eq_codigo;
  END IF;

  IF v_prestamo.estado IN ('Reservado', 'En Curso') THEN
    IF EXISTS (
      SELECT 1
      FROM public.detalle_prestamos d
      JOIN public.prestamos p ON p.id_prestamo = d.id_prestamo
      WHERE d.id_equipo = NEW.id_equipo
        AND d.id_prestamo <> NEW.id_prestamo
        AND p.estado IN ('Reservado', 'En Curso')
        AND p.fecha_prestamo = v_prestamo.fecha_prestamo
        AND p.hora_inicio_prevista < v_prestamo.hora_fin_prevista
        AND p.hora_fin_prevista > v_prestamo.hora_inicio_prevista
    ) THEN
      RAISE EXCEPTION 'El equipo % ya está reservado en ese bloque horario', v_eq_codigo;
    END IF;

    SELECT (
      EXISTS (
        SELECT 1
        FROM public.usuario_roles ur
        JOIN public.roles r ON r.id_rol = ur.id_rol
        WHERE ur.id_usuario = v_prestamo.id_usuario
          AND r.nombre = 'Estudiante'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.usuario_roles ur
        JOIN public.roles r ON r.id_rol = ur.id_rol
        WHERE ur.id_usuario = v_prestamo.id_usuario
          AND r.nombre IN ('Administrativo', 'Profesor Adjunto')
      )
    )
    INTO v_es_limitado;

    IF v_es_limitado THEN
      SELECT nombre, limite_alumnos
      INTO v_cat_nombre, v_limite
      FROM public.categorias_equipo
      WHERE id_categoria = v_id_categoria;

      IF v_limite IS NOT NULL THEN
        SELECT count(*)::integer
        INTO v_activas
        FROM public.detalle_prestamos d
        JOIN public.prestamos p ON p.id_prestamo = d.id_prestamo
        JOIN public.equipos e ON e.id_equipo = d.id_equipo
        WHERE p.id_usuario = v_prestamo.id_usuario
          AND p.estado IN ('Reservado', 'En Curso')
          AND e.id_categoria = v_id_categoria;

        IF v_activas >= v_limite THEN
          RAISE EXCEPTION 'Has alcanzado el límite máximo de % equipo(s) simultáneos en la categoría %', v_limite, v_cat_nombre;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_detalle_prestamo_antes_de_crear ON detalle_prestamos;
CREATE TRIGGER trg_validar_detalle_prestamo_antes_de_crear
BEFORE INSERT ON detalle_prestamos
FOR EACH ROW
EXECUTE FUNCTION public.validar_detalle_prestamo_antes_de_crear();

-- Gestión de usuarios y bajas programadas (solo Administrativo)
CREATE OR REPLACE FUNCTION public.validar_admin_token(p_token text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
BEGIN
  SELECT u.id_usuario INTO v_admin_id
  FROM sesiones_usuario s
  JOIN usuarios u ON u.id_usuario = s.id_usuario
  JOIN usuario_roles ur ON ur.id_usuario = u.id_usuario
  JOIN roles r ON r.id_rol = ur.id_rol
  WHERE s.token = p_token
    AND s.expira_el > NOW()
    AND u.estado <> 'Inactivo'
    AND r.nombre = 'Administrativo'
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'No tenés permisos de administrador o tu sesión expiró';
  END IF;

  RETURN v_admin_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validar_admin_token(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_listar_usuarios(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.validar_admin_token(p_token);

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id_usuario', u.id_usuario,
        'dni', u.dni,
        'nombre', u.nombre,
        'apellido', u.apellido,
        'email', u.email,
        'telefono', u.telefono,
        'curso', u.curso,
        'estado', u.estado,
        'debe_cambiar_password', COALESCE(u.debe_cambiar_password, false),
        'fecha_baja_programada', u.fecha_baja_programada,
        'motivo_baja', u.motivo_baja,
        'roles', COALESCE((
          SELECT jsonb_agg(to_jsonb(r) ORDER BY r.nombre)
          FROM usuario_roles ur
          JOIN roles r ON r.id_rol = ur.id_rol
          WHERE ur.id_usuario = u.id_usuario
        ), '[]'::jsonb)
      )
      ORDER BY u.apellido, u.nombre
    )
    FROM usuarios u
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_crear_usuario(
  p_token text,
  p_dni text,
  p_nombre text,
  p_apellido text,
  p_email text,
  p_telefono text,
  p_curso text,
  p_password text,
  p_estado text,
  p_roles uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id_usuario uuid;
  v_rol_id uuid;
  v_curso text;
  v_dni text;
BEGIN
  PERFORM public.validar_admin_token(p_token);

  v_dni := btrim(COALESCE(p_dni, ''));

  IF v_dni = '' OR btrim(COALESCE(p_nombre, '')) = '' OR btrim(COALESCE(p_apellido, '')) = '' THEN
    RAISE EXCEPTION 'DNI, nombre y apellido son obligatorios';
  END IF;

  IF btrim(COALESCE(p_email, '')) = '' THEN
    RAISE EXCEPTION 'El correo electrónico es obligatorio';
  END IF;

  IF length(COALESCE(p_password, '')) < 6 THEN
    RAISE EXCEPTION 'La contraseña inicial debe tener al menos 6 caracteres';
  END IF;

  IF p_roles IS NULL OR array_length(p_roles, 1) IS NULL THEN
    RAISE EXCEPTION 'Debés asignar al menos un rol al usuario';
  END IF;

  v_curso := NULLIF(btrim(COALESCE(p_curso, '')), '');
  IF v_curso IS NOT NULL AND v_curso NOT IN ('1°', '2°', '3°', 'Egresado') THEN
    RAISE EXCEPTION 'El curso debe ser 1°, 2°, 3° o Egresado';
  END IF;

  INSERT INTO usuarios (dni, nombre, apellido, email, telefono, curso, password_hash, estado, debe_cambiar_password)
  VALUES (
    v_dni,
    btrim(p_nombre),
    btrim(p_apellido),
    lower(btrim(p_email)),
    NULLIF(btrim(COALESCE(p_telefono, '')), ''),
    v_curso,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    COALESCE(NULLIF(p_estado, ''), 'Activo'),
    (btrim(p_password) = v_dni)
  )
  RETURNING id_usuario INTO v_id_usuario;

  FOREACH v_rol_id IN ARRAY p_roles LOOP
    INSERT INTO usuario_roles (id_usuario, id_rol)
    VALUES (v_id_usuario, v_rol_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN v_id_usuario;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_actualizar_usuario(
  p_token text,
  p_id_usuario uuid,
  p_dni text,
  p_nombre text,
  p_apellido text,
  p_email text,
  p_telefono text,
  p_curso text,
  p_estado text,
  p_roles uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_rol_id uuid;
  v_curso text;
BEGIN
  v_admin_id := public.validar_admin_token(p_token);

  IF p_roles IS NULL OR array_length(p_roles, 1) IS NULL THEN
    RAISE EXCEPTION 'El usuario debe tener al menos un rol asignado';
  END IF;

  IF p_id_usuario = v_admin_id AND p_estado <> 'Activo' THEN
    RAISE EXCEPTION 'No podés desactivar o sancionar tu propia cuenta mientras estás conectado';
  END IF;

  v_curso := NULLIF(btrim(COALESCE(p_curso, '')), '');
  IF v_curso IS NOT NULL AND v_curso NOT IN ('1°', '2°', '3°', 'Egresado') THEN
    RAISE EXCEPTION 'El curso debe ser 1°, 2°, 3° o Egresado';
  END IF;

  UPDATE usuarios
  SET
    dni = btrim(p_dni),
    nombre = btrim(p_nombre),
    apellido = btrim(p_apellido),
    email = lower(btrim(p_email)),
    telefono = NULLIF(btrim(COALESCE(p_telefono, '')), ''),
    curso = v_curso,
    estado = p_estado,
    fecha_baja_programada = CASE WHEN p_estado = 'Activo' THEN NULL ELSE fecha_baja_programada END,
    motivo_baja = CASE WHEN p_estado = 'Activo' THEN NULL ELSE motivo_baja END
  WHERE id_usuario = p_id_usuario;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El usuario no existe';
  END IF;

  DELETE FROM usuario_roles WHERE id_usuario = p_id_usuario;
  FOREACH v_rol_id IN ARRAY p_roles LOOP
    INSERT INTO usuario_roles (id_usuario, id_rol)
    VALUES (p_id_usuario, v_rol_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  IF p_estado = 'Inactivo' THEN
    DELETE FROM sesiones_usuario WHERE id_usuario = p_id_usuario;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_programar_baja_usuario(
  p_token text,
  p_id_usuario uuid,
  p_dias integer,
  p_motivo text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_fecha_baja date;
BEGIN
  v_admin_id := public.validar_admin_token(p_token);

  IF p_id_usuario = v_admin_id THEN
    RAISE EXCEPTION 'No podés dar de baja tu propia cuenta';
  END IF;

  IF p_dias IS NULL OR p_dias < 0 OR p_dias > 365 THEN
    RAISE EXCEPTION 'El plazo en días debe estar entre 0 y 365';
  END IF;

  IF p_dias = 0 THEN
    IF EXISTS (
      SELECT 1 FROM prestamos
      WHERE id_usuario = p_id_usuario
        AND estado IN ('Reservado', 'En Curso')
    ) THEN
      RAISE EXCEPTION 'El usuario tiene préstamos o reservas activas; debe devolver los equipos antes de eliminarlo';
    END IF;

    DELETE FROM usuarios WHERE id_usuario = p_id_usuario;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El usuario no existe';
    END IF;
    RETURN 'eliminado';
  END IF;

  v_fecha_baja := v_hoy + p_dias;

  UPDATE usuarios
  SET
    estado = 'Inactivo',
    fecha_baja_programada = v_fecha_baja,
    motivo_baja = COALESCE(NULLIF(btrim(p_motivo), ''), 'Egreso / Baja programada')
  WHERE id_usuario = p_id_usuario;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El usuario no existe';
  END IF;

  DELETE FROM sesiones_usuario WHERE id_usuario = p_id_usuario;

  RETURN 'programado';
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_cancelar_baja_usuario(
  p_token text,
  p_id_usuario uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.validar_admin_token(p_token);

  UPDATE usuarios
  SET
    estado = 'Activo',
    fecha_baja_programada = NULL,
    motivo_baja = NULL
  WHERE id_usuario = p_id_usuario;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El usuario no existe';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_depurar_bajas_vencidas(p_token text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_eliminados integer;
BEGIN
  PERFORM public.validar_admin_token(p_token);

  WITH eliminados AS (
    DELETE FROM usuarios u
    WHERE u.fecha_baja_programada IS NOT NULL
      AND u.fecha_baja_programada <= v_hoy
      AND NOT EXISTS (
        SELECT 1 FROM prestamos p
        WHERE p.id_usuario = u.id_usuario
          AND p.estado IN ('Reservado', 'En Curso')
      )
    RETURNING u.id_usuario
  )
  SELECT count(*)::integer INTO v_eliminados FROM eliminados;

  RETURN COALESCE(v_eliminados, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.cambiar_mi_password(
  p_token text,
  p_password_actual text,
  p_password_nueva text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_usuario usuarios%ROWTYPE;
BEGIN
  SELECT u.* INTO v_usuario
  FROM sesiones_usuario s
  JOIN usuarios u ON u.id_usuario = s.id_usuario
  WHERE s.token = p_token
    AND s.expira_el > NOW()
    AND u.estado <> 'Inactivo'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tu sesión expiró; iniciá sesión nuevamente';
  END IF;

  IF extensions.crypt(COALESCE(p_password_actual, ''), v_usuario.password_hash) <> v_usuario.password_hash THEN
    RAISE EXCEPTION 'La contraseña actual es incorrecta';
  END IF;

  IF length(COALESCE(p_password_nueva, '')) < 6 THEN
    RAISE EXCEPTION 'La nueva contraseña debe tener al menos 6 caracteres';
  END IF;

  IF btrim(p_password_nueva) = btrim(v_usuario.dni) THEN
    RAISE EXCEPTION 'La nueva contraseña no puede ser igual a tu DNI';
  END IF;

  IF p_password_nueva = p_password_actual THEN
    RAISE EXCEPTION 'Elegí una contraseña diferente a la actual';
  END IF;

  UPDATE usuarios
  SET
    password_hash = extensions.crypt(p_password_nueva, extensions.gen_salt('bf')),
    debe_cambiar_password = false
  WHERE id_usuario = v_usuario.id_usuario;

  RETURN jsonb_build_object('token', p_token) || public.datos_sesion(v_usuario.id_usuario);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_restablecer_password_usuario(
  p_token text,
  p_id_usuario uuid,
  p_password_nueva text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_usuario usuarios%ROWTYPE;
  v_nueva text;
BEGIN
  v_admin_id := public.validar_admin_token(p_token);

  IF p_id_usuario = v_admin_id THEN
    RAISE EXCEPTION 'Para cambiar tu propia contraseña usá el botón "Cambiar contraseña" en el encabezado';
  END IF;

  SELECT * INTO v_usuario FROM usuarios WHERE id_usuario = p_id_usuario;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El usuario no existe';
  END IF;

  v_nueva := COALESCE(NULLIF(btrim(p_password_nueva), ''), btrim(v_usuario.dni));

  IF length(v_nueva) < 6 THEN
    RAISE EXCEPTION 'La contraseña debe tener al menos 6 caracteres';
  END IF;

  UPDATE usuarios
  SET
    password_hash = extensions.crypt(v_nueva, extensions.gen_salt('bf')),
    debe_cambiar_password = true
  WHERE id_usuario = p_id_usuario;

  DELETE FROM sesiones_usuario WHERE id_usuario = p_id_usuario;
END;
$$;

-- Permisos de ejecución de RPCs
REVOKE EXECUTE ON FUNCTION public.iniciar_sesion(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.restaurar_sesion(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cerrar_sesion(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.actualizar_limite_categoria(text, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancelar_reservas_vencidas() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_listar_usuarios(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_crear_usuario(text, text, text, text, text, text, text, text, text, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_actualizar_usuario(text, uuid, text, text, text, text, text, text, text, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_programar_baja_usuario(text, uuid, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_cancelar_baja_usuario(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_depurar_bajas_vencidas(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cambiar_mi_password(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_restablecer_password_usuario(text, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.iniciar_sesion(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restaurar_sesion(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cerrar_sesion(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_limite_categoria(text, uuid, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_reservas_vencidas() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_listar_usuarios(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_crear_usuario(text, text, text, text, text, text, text, text, text, uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_actualizar_usuario(text, uuid, text, text, text, text, text, text, text, uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_programar_baja_usuario(text, uuid, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancelar_baja_usuario(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_depurar_bajas_vencidas(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cambiar_mi_password(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_restablecer_password_usuario(text, uuid, text) TO anon, authenticated;

-- Código corto de retiro (4 caracteres: 1 letra al inicio o al final + 3 dígitos, sin 0/O ni 1/I)
CREATE OR REPLACE FUNCTION public.generar_codigo_retiro()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_letras  text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_digitos text := '23456789';
  v_letra   text;
  v_nums    text;
  v_code    text;
  v_i       integer;
  v_intento integer := 0;
BEGIN
  LOOP
    v_intento := v_intento + 1;
    v_letra := substr(v_letras, 1 + floor(random() * length(v_letras))::integer, 1);
    v_nums := '';
    FOR v_i IN 1..3 LOOP
      v_nums := v_nums || substr(v_digitos, 1 + floor(random() * length(v_digitos))::integer, 1);
    END LOOP;

    IF random() < 0.5 THEN
      v_code := v_letra || v_nums;
    ELSE
      v_code := v_nums || v_letra;
    END IF;

    EXIT WHEN NOT EXISTS (SELECT 1 FROM prestamos WHERE codigo_retiro = v_code)
           OR v_intento >= 500;
  END LOOP;
  RETURN v_code;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generar_codigo_retiro() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.asignar_codigo_retiro_prestamo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.codigo_retiro IS NULL OR btrim(NEW.codigo_retiro) = '' THEN
    NEW.codigo_retiro := public.generar_codigo_retiro();
  ELSE
    NEW.codigo_retiro := upper(btrim(NEW.codigo_retiro));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_asignar_codigo_retiro_prestamo ON prestamos;
CREATE TRIGGER trg_asignar_codigo_retiro_prestamo
BEFORE INSERT ON prestamos
FOR EACH ROW
EXECUTE FUNCTION public.asignar_codigo_retiro_prestamo();

CREATE OR REPLACE FUNCTION public.admin_buscar_prestamo_por_codigo(
  p_token text,
  p_codigo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limpio text;
  v_resultado jsonb;
BEGIN
  PERFORM public.validar_admin_token(p_token);
  PERFORM public.cancelar_reservas_vencidas();

  v_limpio := upper(regexp_replace(COALESCE(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
  IF length(v_limpio) < 4 THEN
    RAISE EXCEPTION 'Ingresá un código de retiro válido';
  END IF;

  SELECT jsonb_build_object(
    'id_prestamo', p.id_prestamo,
    'id_usuario', p.id_usuario,
    'fecha_solicitud', p.fecha_solicitud,
    'fecha_prestamo', p.fecha_prestamo,
    'hora_inicio_prevista', p.hora_inicio_prevista,
    'hora_fin_prevista', p.hora_fin_prevista,
    'retiro_desde', p.retiro_desde,
    'retiro_hasta', p.retiro_hasta,
    'hora_retiro_real', p.hora_retiro_real,
    'hora_devolucion_real', p.hora_devolucion_real,
    'estado', p.estado,
    'codigo_retiro', p.codigo_retiro,
    'metodo_entrega', p.metodo_entrega,
    'metodo_devolucion', p.metodo_devolucion,
    'observaciones_entrega', p.observaciones_entrega,
    'observaciones_devolucion', p.observaciones_devolucion,
    'usuarios', jsonb_build_object(
      'id_usuario', u.id_usuario,
      'dni', u.dni,
      'nombre', u.nombre,
      'apellido', u.apellido,
      'estado', u.estado
    ),
    'detalle_prestamos', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id_detalle', d.id_detalle,
          'id_prestamo', d.id_prestamo,
          'id_equipo', d.id_equipo,
          'estado_salida', d.estado_salida,
          'estado_devolucion', d.estado_devolucion,
          'equipos', jsonb_build_object(
            'id_equipo', e.id_equipo,
            'id_categoria', e.id_categoria,
            'codigo_inventario', e.codigo_inventario,
            'numero_serie', e.numero_serie,
            'marca_modelo', e.marca_modelo,
            'estado', e.estado,
            'observaciones', e.observaciones,
            'categorias_equipo', jsonb_build_object(
              'id_categoria', c.id_categoria,
              'nombre', c.nombre,
              'descripcion', c.descripcion,
              'limite_alumnos', c.limite_alumnos
            )
          )
        )
      )
      FROM detalle_prestamos d
      JOIN equipos e ON e.id_equipo = d.id_equipo
      JOIN categorias_equipo c ON c.id_categoria = e.id_categoria
      WHERE d.id_prestamo = p.id_prestamo
    ), '[]'::jsonb)
  )
  INTO v_resultado
  FROM prestamos p
  JOIN usuarios u ON u.id_usuario = p.id_usuario
  WHERE upper(p.codigo_retiro) = v_limpio
  LIMIT 1;

  IF v_resultado IS NULL THEN
    RAISE EXCEPTION 'No encontramos ninguna reserva con el código %', v_limpio;
  END IF;

  RETURN v_resultado;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_buscar_prestamo_por_codigo(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_buscar_prestamo_por_codigo(text, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.admin_guardar_configuracion_horarios(text, boolean, integer, time, jsonb);

CREATE OR REPLACE FUNCTION public.admin_guardar_configuracion_horarios(
  p_token text,
  p_franjas_activas boolean,
  p_tolerancia_retiro_min integer,
  p_hora_cierre_devolucion time,
  p_franjas jsonb,
  p_dias_anticipacion_max integer DEFAULT 7,
  p_permitir_fines_de_semana boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_guardado public.configuracion_horarios%ROWTYPE;
BEGIN
  PERFORM public.validar_admin_token(p_token);

  IF p_tolerancia_retiro_min IS NULL OR p_tolerancia_retiro_min < 0 OR p_tolerancia_retiro_min > 60 THEN
    RAISE EXCEPTION 'La tolerancia debe estar entre 0 y 60 minutos';
  END IF;

  IF p_hora_cierre_devolucion IS NULL THEN
    RAISE EXCEPTION 'Indicá una hora máxima de devolución';
  END IF;

  IF p_franjas IS NULL OR jsonb_typeof(p_franjas) <> 'array' THEN
    RAISE EXCEPTION 'El listado de franjas tiene un formato inválido';
  END IF;

  IF p_franjas_activas AND jsonb_array_length(p_franjas) = 0 THEN
    RAISE EXCEPTION 'Agregá al menos una franja de retiro o desactivá la restricción';
  END IF;

  IF p_dias_anticipacion_max IS NULL OR p_dias_anticipacion_max < 0 OR p_dias_anticipacion_max > 90 THEN
    RAISE EXCEPTION 'Los días máximos de anticipación deben estar entre 0 y 90';
  END IF;

  INSERT INTO public.configuracion_horarios (
    id,
    franjas_activas,
    tolerancia_retiro_min,
    hora_cierre_devolucion,
    franjas,
    dias_anticipacion_max,
    permitir_fines_de_semana,
    updated_at
  )
  VALUES (
    1,
    p_franjas_activas,
    p_tolerancia_retiro_min,
    p_hora_cierre_devolucion,
    p_franjas,
    p_dias_anticipacion_max,
    COALESCE(p_permitir_fines_de_semana, false),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    franjas_activas = EXCLUDED.franjas_activas,
    tolerancia_retiro_min = EXCLUDED.tolerancia_retiro_min,
    hora_cierre_devolucion = EXCLUDED.hora_cierre_devolucion,
    franjas = EXCLUDED.franjas,
    dias_anticipacion_max = EXCLUDED.dias_anticipacion_max,
    permitir_fines_de_semana = EXCLUDED.permitir_fines_de_semana,
    updated_at = now()
  RETURNING * INTO v_guardado;

  RETURN to_jsonb(v_guardado);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_guardar_configuracion_horarios(text, boolean, integer, time, jsonb, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_guardar_configuracion_horarios(text, boolean, integer, time, jsonb, integer, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_cambiar_equipo_prestamo(
  p_token text,
  p_id_prestamo uuid,
  p_id_detalle uuid,
  p_id_equipo_nuevo uuid,
  p_estado_equipo_anterior text DEFAULT 'Disponible',
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prestamo            public.prestamos%ROWTYPE;
  v_id_equipo_anterior  uuid;
  v_cod_anterior        text;
  v_cod_nuevo           text;
  v_estado_nuevo        text;
  v_obs_anterior        text;
  v_motivo_limpio       text;
  v_nota_cambio         text;
BEGIN
  PERFORM public.validar_admin_token(p_token);

  IF p_estado_equipo_anterior NOT IN ('Disponible', 'En mantenimiento') THEN
    RAISE EXCEPTION 'Estado inválido para el equipo devuelto';
  END IF;

  SELECT * INTO v_prestamo
  FROM public.prestamos
  WHERE id_prestamo = p_id_prestamo
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El préstamo indicado no existe';
  END IF;

  IF v_prestamo.estado <> 'En Curso' THEN
    RAISE EXCEPTION 'Solo se puede cambiar equipos en préstamos En Curso';
  END IF;

  SELECT d.id_equipo INTO v_id_equipo_anterior
  FROM public.detalle_prestamos d
  WHERE d.id_detalle = p_id_detalle
    AND d.id_prestamo = p_id_prestamo
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El detalle de equipo no pertenece a este préstamo';
  END IF;

  IF v_id_equipo_anterior = p_id_equipo_nuevo THEN
    RAISE EXCEPTION 'Elegí un equipo diferente al actual';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.detalle_prestamos d2
    WHERE d2.id_prestamo = p_id_prestamo
      AND d2.id_equipo = p_id_equipo_nuevo
  ) THEN
    RAISE EXCEPTION 'El equipo nuevo ya forma parte de este préstamo';
  END IF;

  SELECT codigo_inventario, estado
  INTO v_cod_nuevo, v_estado_nuevo
  FROM public.equipos
  WHERE id_equipo = p_id_equipo_nuevo
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El equipo nuevo no existe';
  END IF;

  IF v_estado_nuevo <> 'Disponible' THEN
    RAISE EXCEPTION 'El equipo % ya no está Disponible (estado actual: %)', v_cod_nuevo, v_estado_nuevo;
  END IF;

  SELECT codigo_inventario, observaciones
  INTO v_cod_anterior, v_obs_anterior
  FROM public.equipos
  WHERE id_equipo = v_id_equipo_anterior
  FOR UPDATE;

  v_motivo_limpio := NULLIF(btrim(COALESCE(p_motivo, '')), '');

  UPDATE public.detalle_prestamos
  SET
    id_equipo = p_id_equipo_nuevo,
    estado_salida = COALESCE(v_motivo_limpio, 'Cambio en mostrador (reemplaza a ' || COALESCE(v_cod_anterior, 'equipo anterior') || ')')
  WHERE id_detalle = p_id_detalle;

  UPDATE public.equipos
  SET
    estado = p_estado_equipo_anterior,
    observaciones = CASE
      WHEN p_estado_equipo_anterior = 'En mantenimiento' AND v_motivo_limpio IS NOT NULL
        THEN COALESCE(NULLIF(btrim(v_obs_anterior), '') || ' | ', '') || 'Cambio en préstamo: ' || v_motivo_limpio
      ELSE observaciones
    END
  WHERE id_equipo = v_id_equipo_anterior;

  UPDATE public.equipos
  SET estado = 'En préstamo'
  WHERE id_equipo = p_id_equipo_nuevo;

  v_nota_cambio := 'Cambio ' || COALESCE(v_cod_anterior, '') || ' -> ' || COALESCE(v_cod_nuevo, '')
    || CASE WHEN v_motivo_limpio IS NOT NULL THEN ' (' || v_motivo_limpio || ')' ELSE '' END;

  UPDATE public.prestamos
  SET observaciones_entrega = CASE
    WHEN NULLIF(btrim(COALESCE(observaciones_entrega, '')), '') IS NULL THEN v_nota_cambio
    ELSE btrim(observaciones_entrega) || ' | ' || v_nota_cambio
  END
  WHERE id_prestamo = p_id_prestamo;

  RETURN jsonb_build_object(
    'equipo_anterior', v_cod_anterior,
    'equipo_nuevo', v_cod_nuevo
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_cambiar_equipo_prestamo(text, uuid, uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_cambiar_equipo_prestamo(text, uuid, uuid, uuid, text, text) TO anon, authenticated;

-- ============================================================================
-- 4. DATOS INICIALES (SEED DEMO ITU)
-- ============================================================================

INSERT INTO roles (nombre, descripcion) VALUES
  ('Estudiante',       'Alumno de la universidad ITU'),
  ('Profesor Adjunto', 'Docente adjunto a cargo de comisiones'),
  ('Administrativo',   'Personal administrativo y gestión del pañol')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO categorias_equipo (nombre, descripcion, limite_alumnos) VALUES
  ('Notebook',  'Laptop para uso académico', 2),
  ('Router',    'Equipo de red para prácticas', NULL),
  ('Cable',     'Cables de red / alimentación', NULL),
  ('Zapatilla', 'Calzado técnico de laboratorio', NULL),
  ('TV',        'Monitor / TV para aulas', NULL)
ON CONFLICT (nombre) DO NOTHING;

-- Usuarios iniciales con contraseñas cifradas (bcrypt)
INSERT INTO usuarios (dni, nombre, apellido, email, telefono, curso, password_hash, estado) VALUES
  ('34000001', 'Ana',   'López',     'ana.lopez@itu.edu.ar',      '11-5555-0001', '2°', extensions.crypt('demo1234',  extensions.gen_salt('bf')), 'Activo'),
  ('34000002', 'Bruno', 'Martínez',  'bruno.martinez@itu.edu.ar', '11-5555-0002', '2°', extensions.crypt('demo1234',  extensions.gen_salt('bf')), 'Activo'),
  ('34000003', 'Carla', 'Sosa',      'carla.sosa@itu.edu.ar',     '11-5555-0003', '1°', extensions.crypt('demo1234',  extensions.gen_salt('bf')), 'Sancionado'),
  ('34000004', 'Pablo', 'Ríos',      'pablo.rios@itu.edu.ar',     '11-5555-0004', '1°', extensions.crypt('demo1234',  extensions.gen_salt('bf')), 'Activo'),
  ('34000005', 'Sofía', 'Núñez',     'sofia.nunez@itu.edu.ar',    '11-5555-0005', NULL, extensions.crypt('panol1234', extensions.gen_salt('bf')), 'Activo'),
  ('34000006', 'Diego', 'Fernández', 'diego.fernandez@itu.edu.ar','11-5555-0006', NULL, extensions.crypt('demo1234',  extensions.gen_salt('bf')), 'Activo')
ON CONFLICT (dni) DO NOTHING;

-- Asegura cifrado si existía algún usuario previo en texto plano
UPDATE usuarios
SET password_hash = extensions.crypt(password_hash, extensions.gen_salt('bf'))
WHERE password_hash NOT LIKE '$2%';

-- Asignación de roles
INSERT INTO usuario_roles (id_usuario, id_rol)
SELECT u.id_usuario, r.id_rol FROM usuarios u, roles r
WHERE u.dni IN ('34000001','34000002','34000003') AND r.nombre = 'Estudiante'
ON CONFLICT DO NOTHING;

INSERT INTO usuario_roles (id_usuario, id_rol)
SELECT u.id_usuario, r.id_rol FROM usuarios u, roles r
WHERE u.dni = '34000004' AND r.nombre IN ('Estudiante', 'Profesor Adjunto')
ON CONFLICT DO NOTHING;

INSERT INTO usuario_roles (id_usuario, id_rol)
SELECT u.id_usuario, r.id_rol FROM usuarios u, roles r
WHERE u.dni = '34000006' AND r.nombre = 'Administrativo'
ON CONFLICT DO NOTHING;

INSERT INTO usuario_roles (id_usuario, id_rol)
SELECT u.id_usuario, r.id_rol FROM usuarios u, roles r
WHERE u.dni = '34000005' AND r.nombre = 'Administrativo'
ON CONFLICT DO NOTHING;

-- Equipos de inventario inicial (50 Notebooks CX reales)
INSERT INTO equipos (id_categoria, codigo_inventario, numero_serie, marca_modelo, estado, oculto_catalogo, observaciones)
SELECT c.id_categoria, v.codigo_inventario, v.numero_serie, 'Notebook CX', v.estado, v.oculto_catalogo, v.observaciones
FROM categorias_equipo c
CROSS JOIN (
  VALUES
    ('10778', 'CX30M1522081124', 'Disponible',       false, NULL),
    ('10779', 'CX30M1522081083', 'Disponible',       false, NULL),
    ('10780', 'CX30M1522081144', 'Disponible',       false, NULL),
    ('10781', 'CX30M1522081152', 'Disponible',       false, NULL),
    ('10782', 'CX30M1522081081', 'Disponible',       false, NULL),
    ('10783', 'CX30M1522081153', 'Disponible',       false, NULL),
    ('10784', 'CX30M1522081148', 'Disponible',       false, NULL),
    ('10785', 'CX30M1522081150', 'Disponible',       false, NULL),
    ('10786', 'CX30M1522081142', 'Disponible',       false, NULL),
    ('10787', 'CX30M1522081084', 'Disponible',       false, NULL),
    ('10788', 'CX30M1522081128', 'Disponible',       false, NULL),
    ('10789', 'CX30M1522081159', 'Disponible',       false, NULL),
    ('10790', 'CX30M1522081158', 'Disponible',       true,  'Administrac.'),
    ('10791', 'CX30M1522081156', 'Disponible',       false, NULL),
    ('10792', 'CX30M1522081157', 'Disponible',       false, NULL),
    ('10793', 'CX30M1522081119', 'Disponible',       false, NULL),
    ('10794', 'CX30M1522081098', 'Disponible',       false, NULL),
    ('10795', 'CX30M1522081101', 'Disponible',       false, NULL),
    ('10796', 'CX30M1522081125', 'Disponible',       false, NULL),
    ('10797', 'CX30M1522081117', 'Disponible',       false, NULL),
    ('10798', 'CX30M1522081139', 'Disponible',       false, NULL),
    ('10799', 'CX30M1522081136', 'Disponible',       false, NULL),
    ('10800', 'CX30M1522081137', 'Disponible',       false, NULL),
    ('10801', 'CX30M1522081180', 'Disponible',       false, NULL),
    ('10802', 'CX30M1522081120', 'Disponible',       false, NULL),
    ('10803', 'CX30M1522081131', 'Disponible',       false, NULL),
    ('10804', NULL,              'En mantenimiento', false, 'Municipio de Junin'),
    ('10805', 'CX30M1522081130', 'Disponible',       false, NULL),
    ('10806', 'CX30M1522081132', 'Disponible',       false, NULL),
    ('10807', 'CX30M1522081149', 'En mantenimiento', false, 'No enciende. Matias'),
    ('10808', 'CX30M1522081147', 'Disponible',       false, NULL),
    ('10809', 'CX30M1522081146', 'Disponible',       false, NULL),
    ('10810', 'CX30M1522081155', 'Disponible',       false, NULL),
    ('10811', 'CX30M1522081082', 'Disponible',       false, NULL),
    ('10812', 'CX30M1522081154', 'Disponible',       false, NULL),
    ('10813', 'CX30M1522081135', 'Disponible',       false, NULL),
    ('10814', NULL,              'En mantenimiento', false, 'Municipio de Junin'),
    ('10815', 'CX30M1522081134', 'Disponible',       false, NULL),
    ('10816', 'CX30M1522081161', 'Disponible',       false, NULL),
    ('10817', 'CX30M1522081138', 'Disponible',       false, NULL),
    ('10818', 'CX30M1522081151', 'Disponible',       false, NULL),
    ('10819', 'CX30M1522081143', 'Disponible',       false, NULL),
    ('10820', 'CX30M1522081140', 'Disponible',       false, NULL),
    ('10821', 'CX30M1522081160', 'Disponible',       false, NULL),
    ('10822', 'CX30M1522081183', 'Disponible',       false, NULL),
    ('10823', 'CX30M1522081108', 'Disponible',       false, NULL),
    ('10824', 'CX30M1522081075', 'Disponible',       true,  'uso profesores'),
    ('10825', 'CX30M1522081086', 'Disponible',       false, NULL),
    ('10826', 'CX30M1522081077', 'Disponible',       false, NULL),
    ('10827', 'CX30M1522081112', 'Disponible',       false, NULL)
) AS v(codigo_inventario, numero_serie, estado, oculto_catalogo, observaciones)
WHERE c.nombre = 'Notebook'
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
