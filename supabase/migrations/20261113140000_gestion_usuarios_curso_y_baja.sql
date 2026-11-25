-- ============================================================================
-- Migración incremental: Padrón de usuarios, curso/carrera y baja con cuenta regresiva
-- Ejecutar en Supabase -> SQL Editor -> New query -> Run
-- ============================================================================

-- 1. Nuevas columnas en usuarios
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS curso text,
  ADD COLUMN IF NOT EXISTS fecha_baja_programada date,
  ADD COLUMN IF NOT EXISTS motivo_baja text;

CREATE INDEX IF NOT EXISTS idx_usuarios_curso ON usuarios (curso);
CREATE INDEX IF NOT EXISTS idx_usuarios_baja_programada
  ON usuarios (fecha_baja_programada)
  WHERE fecha_baja_programada IS NOT NULL;

-- Permitir lectura de las nuevas columnas públicas desde el cliente
GRANT SELECT (id_usuario, dni, nombre, apellido, email, estado, curso, fecha_baja_programada, motivo_baja)
  ON usuarios TO anon, authenticated;

-- 2. Actualizar datos_sesion para incluir curso
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

-- 3. Helper interno: validar token de administrador (Pañol o Administrativo)
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
    AND r.nombre IN ('Pañol', 'Administrativo')
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'No tenés permisos de administrador o tu sesión expiró';
  END IF;

  RETURN v_admin_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validar_admin_token(text) FROM PUBLIC, anon, authenticated;

-- 4. Listar usuarios completos para el panel de administración
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

-- 5. Crear usuario nuevo (con contraseña inicial cifrada y roles)
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
BEGIN
  PERFORM public.validar_admin_token(p_token);

  IF btrim(COALESCE(p_dni, '')) = '' OR btrim(COALESCE(p_nombre, '')) = '' OR btrim(COALESCE(p_apellido, '')) = '' THEN
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

  INSERT INTO usuarios (dni, nombre, apellido, email, telefono, curso, password_hash, estado)
  VALUES (
    btrim(p_dni),
    btrim(p_nombre),
    btrim(p_apellido),
    lower(btrim(p_email)),
    NULLIF(btrim(COALESCE(p_telefono, '')), ''),
    NULLIF(btrim(COALESCE(p_curso, '')), ''),
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    COALESCE(NULLIF(p_estado, ''), 'Activo')
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

-- 6. Editar datos, curso, estado y roles de usuario existente (sin tocar contraseña)
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
BEGIN
  v_admin_id := public.validar_admin_token(p_token);

  IF p_roles IS NULL OR array_length(p_roles, 1) IS NULL THEN
    RAISE EXCEPTION 'El usuario debe tener al menos un rol asignado';
  END IF;

  IF p_id_usuario = v_admin_id AND p_estado <> 'Activo' THEN
    RAISE EXCEPTION 'No podés desactivar o sancionar tu propia cuenta mientras estás conectado';
  END IF;

  UPDATE usuarios
  SET
    dni = btrim(p_dni),
    nombre = btrim(p_nombre),
    apellido = btrim(p_apellido),
    email = lower(btrim(p_email)),
    telefono = NULLIF(btrim(COALESCE(p_telefono, '')), ''),
    curso = NULLIF(btrim(COALESCE(p_curso, '')), ''),
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

-- 7. Programar baja con cuenta regresiva en días (o eliminar inmediatamente si días = 0)
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

-- 8. Cancelar cuenta regresiva de baja y reactivar usuario
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

-- 9. Depurar automáticamente usuarios cuya cuenta regresiva llegó a 0 (sin préstamos activos)
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

-- Permisos de ejecución para el cliente
REVOKE EXECUTE ON FUNCTION public.admin_listar_usuarios(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_crear_usuario(text, text, text, text, text, text, text, text, text, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_actualizar_usuario(text, uuid, text, text, text, text, text, text, text, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_programar_baja_usuario(text, uuid, integer, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_cancelar_baja_usuario(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_depurar_bajas_vencidas(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_listar_usuarios(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_crear_usuario(text, text, text, text, text, text, text, text, text, uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_actualizar_usuario(text, uuid, text, text, text, text, text, text, text, uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_programar_baja_usuario(text, uuid, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancelar_baja_usuario(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_depurar_bajas_vencidas(text) TO anon, authenticated;

-- Asignar cursos de ejemplo a los usuarios demo existentes (solo si aún no tienen curso)
UPDATE usuarios SET curso = 'Redes y Telecomunicaciones 2°' WHERE dni IN ('34000001', '34000002') AND curso IS NULL;
UPDATE usuarios SET curso = 'Desarrollo de Software 1°'     WHERE dni = '34000003' AND curso IS NULL;
UPDATE usuarios SET curso = 'Redes y Telecomunicaciones 1°' WHERE dni = '34000004' AND curso IS NULL;
UPDATE usuarios SET curso = 'Pañol Central ITU'             WHERE dni = '34000005' AND curso IS NULL;
UPDATE usuarios SET curso = 'Administración ITU'            WHERE dni = '34000006' AND curso IS NULL;
