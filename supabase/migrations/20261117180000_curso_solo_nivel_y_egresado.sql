-- ============================================================================
-- Migración incremental: Restringir campo curso a 1°, 2°, 3° o Egresado
-- Ejecutar en Supabase -> SQL Editor -> New query -> Run
-- ============================================================================

-- 1. Normalizar valores existentes de curso en usuarios (quitar carreras/áreas)
UPDATE public.usuarios
SET curso = CASE
  WHEN btrim(COALESCE(curso, '')) = '' THEN NULL
  WHEN curso ~* 'egresad' THEN 'Egresado'
  WHEN curso ~ '3°' OR curso ~* '\m3(ro)?\M' THEN '3°'
  WHEN curso ~ '2°' OR curso ~* '\m2(do)?\M' THEN '2°'
  WHEN curso ~ '1°' OR curso ~* '\m1(ro)?\M' THEN '1°'
  ELSE NULL
END;

-- 2. Restricción en tabla usuarios
ALTER TABLE public.usuarios
  DROP CONSTRAINT IF EXISTS chk_usuarios_curso;

ALTER TABLE public.usuarios
  ADD CONSTRAINT chk_usuarios_curso
  CHECK (curso IS NULL OR curso IN ('1°', '2°', '3°', 'Egresado'));

-- 3. Validar curso en admin_crear_usuario
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

  v_curso := NULLIF(btrim(COALESCE(p_curso, '')), '');
  IF v_curso IS NOT NULL AND v_curso NOT IN ('1°', '2°', '3°', 'Egresado') THEN
    RAISE EXCEPTION 'El curso debe ser 1°, 2°, 3° o Egresado';
  END IF;

  INSERT INTO public.usuarios (dni, nombre, apellido, email, telefono, curso, password_hash, estado)
  VALUES (
    btrim(p_dni),
    btrim(p_nombre),
    btrim(p_apellido),
    lower(btrim(p_email)),
    NULLIF(btrim(COALESCE(p_telefono, '')), ''),
    v_curso,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    COALESCE(NULLIF(p_estado, ''), 'Activo')
  )
  RETURNING id_usuario INTO v_id_usuario;

  FOREACH v_rol_id IN ARRAY p_roles LOOP
    INSERT INTO public.usuario_roles (id_usuario, id_rol)
    VALUES (v_id_usuario, v_rol_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN v_id_usuario;
END;
$$;

-- 4. Validar curso en admin_actualizar_usuario
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

  UPDATE public.usuarios
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

  DELETE FROM public.usuario_roles WHERE id_usuario = p_id_usuario;
  FOREACH v_rol_id IN ARRAY p_roles LOOP
    INSERT INTO public.usuario_roles (id_usuario, id_rol)
    VALUES (p_id_usuario, v_rol_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  IF p_estado = 'Inactivo' THEN
    DELETE FROM public.sesiones_usuario WHERE id_usuario = p_id_usuario;
  END IF;
END;
$$;
