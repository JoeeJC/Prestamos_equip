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
        'estado', u.estado
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

CREATE OR REPLACE FUNCTION public.cerrar_sesion(p_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM sesiones_usuario WHERE token = p_token;
$$;

DROP FUNCTION IF EXISTS public.actualizar_limite_categoria(uuid, text, uuid, integer);

CREATE OR REPLACE FUNCTION public.actualizar_limite_categoria(p_token text, p_id_categoria uuid, p_limite integer)
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
      AND r.nombre IN ('Pañol', 'Administrativo')
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

REVOKE EXECUTE ON FUNCTION public.iniciar_sesion(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.restaurar_sesion(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cerrar_sesion(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.actualizar_limite_categoria(text, uuid, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.iniciar_sesion(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restaurar_sesion(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cerrar_sesion(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_limite_categoria(text, uuid, integer) TO anon, authenticated;
