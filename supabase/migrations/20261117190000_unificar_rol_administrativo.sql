-- ============================================================================
-- Migración incremental: Unificar rol Pañol dentro de Administrativo
-- Ejecutar en Supabase -> SQL Editor -> New query -> Run
-- ============================================================================

-- 1. Asegurar que exista el rol Administrativo y migrar usuarios con rol Pañol
INSERT INTO public.roles (nombre, descripcion)
VALUES ('Administrativo', 'Personal administrativo y gestión del pañol')
ON CONFLICT (nombre) DO UPDATE
SET descripcion = EXCLUDED.descripcion;

INSERT INTO public.usuario_roles (id_usuario, id_rol)
SELECT ur.id_usuario, r_admin.id_rol
FROM public.usuario_roles ur
JOIN public.roles r_panol ON r_panol.id_rol = ur.id_rol AND r_panol.nombre = 'Pañol'
JOIN public.roles r_admin ON r_admin.nombre = 'Administrativo'
ON CONFLICT DO NOTHING;

DELETE FROM public.usuario_roles ur
USING public.roles r
WHERE ur.id_rol = r.id_rol
  AND r.nombre = 'Pañol';

DELETE FROM public.roles
WHERE nombre = 'Pañol';

-- 2. Actualizar validar_admin_token (solo Administrativo)
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
  FROM public.sesiones_usuario s
  JOIN public.usuarios u ON u.id_usuario = s.id_usuario
  JOIN public.usuario_roles ur ON ur.id_usuario = u.id_usuario
  JOIN public.roles r ON r.id_rol = ur.id_rol
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

-- 3. Actualizar actualizar_limite_categoria (solo Administrativo)
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
    FROM public.sesiones_usuario s
    JOIN public.usuarios u ON u.id_usuario = s.id_usuario
    JOIN public.usuario_roles ur ON ur.id_usuario = u.id_usuario
    JOIN public.roles r ON r.id_rol = ur.id_rol
    WHERE s.token = p_token
      AND s.expira_el > NOW()
      AND u.estado <> 'Inactivo'
      AND r.nombre = 'Administrativo'
  ) THEN
    RAISE EXCEPTION 'No tenés permisos para modificar el límite o tu sesión expiró';
  END IF;

  UPDATE public.categorias_equipo
  SET limite_alumnos = p_limite
  WHERE id_categoria = p_id_categoria;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La categoría indicada no existe';
  END IF;

  RETURN p_limite;
END;
$$;

-- 4. Actualizar validar_detalle_prestamo_antes_de_crear (roles exentos sin Pañol)
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

  SELECT estado, codigo_inventario, id_categoria
  INTO v_eq_estado, v_eq_codigo, v_id_categoria
  FROM public.equipos
  WHERE id_equipo = NEW.id_equipo
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El equipo seleccionado no existe';
  END IF;

  IF v_eq_estado IN ('En mantenimiento', 'Baja') THEN
    RAISE EXCEPTION 'El equipo % no está operativo (%)', v_eq_codigo, v_eq_estado;
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
