-- ============================================================================
-- Migración incremental: Franjas de retiro, tolerancia, cierre y cambio de equipo
-- Ejecutar en Supabase -> SQL Editor -> New query -> Run
-- ============================================================================

-- 1. Tabla de configuración de horarios y tolerancia (editable solo por admin vía RPC)
CREATE TABLE IF NOT EXISTS public.configuracion_horarios (
  id                     integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  franjas_activas        boolean NOT NULL DEFAULT true,
  tolerancia_retiro_min  integer NOT NULL DEFAULT 5 CHECK (tolerancia_retiro_min BETWEEN 0 AND 60),
  hora_cierre_devolucion time NOT NULL DEFAULT '22:00:00',
  franjas                jsonb NOT NULL DEFAULT '[
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
  updated_at             timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.configuracion_horarios (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.configuracion_horarios ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.configuracion_horarios FROM anon, authenticated;
GRANT SELECT ON public.configuracion_horarios TO anon, authenticated;

DROP POLICY IF EXISTS "configuracion_horarios_select" ON public.configuracion_horarios;
CREATE POLICY "configuracion_horarios_select"
  ON public.configuracion_horarios
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- 2. Ventana de retiro en préstamos
ALTER TABLE public.prestamos
  ADD COLUMN IF NOT EXISTS retiro_desde time,
  ADD COLUMN IF NOT EXISTS retiro_hasta time;

-- 3. Actualizar caducidad automática considerando franja de retiro + tolerancia configurable
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
    FROM public.prestamos p
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
    FROM public.detalle_prestamos d
    JOIN vencidos v ON v.id_prestamo = d.id_prestamo
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.detalle_prestamos d2
      JOIN public.prestamos p2 ON p2.id_prestamo = d2.id_prestamo
      WHERE d2.id_equipo = d.id_equipo
        AND p2.estado IN ('Reservado', 'En Curso')
        AND p2.id_prestamo NOT IN (SELECT id_prestamo FROM vencidos)
    )
  ),
  equipos_actualizados AS (
    UPDATE public.equipos e
    SET estado = 'Disponible'
    FROM equipos_liberables l
    WHERE e.id_equipo = l.id_equipo
      AND e.estado = 'Reservado'
    RETURNING e.id_equipo
  ),
  prestamos_cancelados AS (
    UPDATE public.prestamos p
    SET estado = 'No Presentado'
    FROM vencidos v
    WHERE p.id_prestamo = v.id_prestamo
    RETURNING p.id_prestamo
  )
  SELECT count(*)::integer INTO v_total FROM prestamos_cancelados;

  RETURN COALESCE(v_total, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancelar_reservas_vencidas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancelar_reservas_vencidas() TO anon, authenticated;

-- 4. RPC segura para guardar franjas, tolerancia y hora máxima de cierre
CREATE OR REPLACE FUNCTION public.admin_guardar_configuracion_horarios(
  p_token text,
  p_franjas_activas boolean,
  p_tolerancia_retiro_min integer,
  p_hora_cierre_devolucion time,
  p_franjas jsonb
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

  INSERT INTO public.configuracion_horarios (
    id,
    franjas_activas,
    tolerancia_retiro_min,
    hora_cierre_devolucion,
    franjas,
    updated_at
  )
  VALUES (
    1,
    p_franjas_activas,
    p_tolerancia_retiro_min,
    p_hora_cierre_devolucion,
    p_franjas,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    franjas_activas = EXCLUDED.franjas_activas,
    tolerancia_retiro_min = EXCLUDED.tolerancia_retiro_min,
    hora_cierre_devolucion = EXCLUDED.hora_cierre_devolucion,
    franjas = EXCLUDED.franjas,
    updated_at = now()
  RETURNING * INTO v_guardado;

  RETURN to_jsonb(v_guardado);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_guardar_configuracion_horarios(text, boolean, integer, time, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_guardar_configuracion_horarios(text, boolean, integer, time, jsonb) TO anon, authenticated;

-- 5. RPC para cambiar un equipo en un préstamo En Curso (sin restricciones de franja)
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

-- 6. Incluir retiro_desde y retiro_hasta al buscar préstamo por QR/código
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
