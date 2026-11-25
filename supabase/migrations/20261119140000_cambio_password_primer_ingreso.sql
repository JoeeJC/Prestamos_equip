-- ============================================================================
-- Migración: Cambio de contraseña obligatorio en primer ingreso (Opción A)
-- Ejecutar en Supabase -> SQL Editor -> New query -> Run
-- ============================================================================

-- 1. Columna para indicar que el usuario debe cambiar su contraseña al ingresar
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS debe_cambiar_password boolean NOT NULL DEFAULT false;

-- 2. Incluir el flag en datos_sesion (usado por iniciar_sesion y restaurar_sesion)
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

-- 3. Incluir el flag en el listado administrativo de usuarios
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

-- 4. Marcar automáticamente debe_cambiar_password = true si la clave inicial coincide con el DNI
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

  INSERT INTO usuarios (
    dni,
    nombre,
    apellido,
    email,
    telefono,
    curso,
    password_hash,
    estado,
    debe_cambiar_password
  )
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

-- 5. RPC para que cualquier usuario autenticado cambie su propia contraseña
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

-- 6. RPC para que un administrador restablezca la contraseña de un usuario (por defecto a su DNI)
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

REVOKE EXECUTE ON FUNCTION public.cambiar_mi_password(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cambiar_mi_password(text, text, text) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_restablecer_password_usuario(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_restablecer_password_usuario(text, uuid, text) TO anon, authenticated;
