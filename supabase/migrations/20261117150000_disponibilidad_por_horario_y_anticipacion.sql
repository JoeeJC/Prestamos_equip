-- ============================================================================
-- Migración incremental: Disponibilidad por fecha/horario y anticipación máxima
-- Ejecutar en Supabase -> SQL Editor -> New query -> Run
-- ============================================================================

-- 1. Parámetros de anticipación y fines de semana en configuracion_horarios
ALTER TABLE public.configuracion_horarios
  ADD COLUMN IF NOT EXISTS dias_anticipacion_max integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS permitir_fines_de_semana boolean NOT NULL DEFAULT false;

ALTER TABLE public.configuracion_horarios
  DROP CONSTRAINT IF EXISTS chk_dias_anticipacion_max;
ALTER TABLE public.configuracion_horarios
  ADD CONSTRAINT chk_dias_anticipacion_max CHECK (dias_anticipacion_max BETWEEN 0 AND 90);

-- 2. Liberar equipos que quedaron bloqueados globalmente como 'Reservado'
--    (ahora la reserva vive por fecha y bloque horario en prestamos/detalle_prestamos)
UPDATE public.equipos
SET estado = 'Disponible'
WHERE estado = 'Reservado';

-- 3. Actualizar RPC admin_guardar_configuracion_horarios con anticipación y fines de semana
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

-- 4. Ajustar trigger de cancelación para distinguir estado físico En préstamo vs reservas futuras
CREATE OR REPLACE FUNCTION public.liberar_equipos_al_cancelar_prestamo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.estado IN ('Cancelado', 'No Presentado')
     AND OLD.estado IN ('Reservado', 'En Curso') THEN
    UPDATE public.equipos e
    SET estado = 'Disponible'
    FROM public.detalle_prestamos d
    WHERE d.id_prestamo = NEW.id_prestamo
      AND e.id_equipo = d.id_equipo
      AND (
        e.estado = 'Reservado'
        OR (
          e.estado = 'En préstamo'
          AND OLD.estado = 'En Curso'
          AND NOT EXISTS (
            SELECT 1
            FROM public.detalle_prestamos d2
            JOIN public.prestamos p2 ON p2.id_prestamo = d2.id_prestamo
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

-- 5. Validación en base de datos al crear una reserva (anticipación, fines de semana, cierre, usuario)
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

DROP TRIGGER IF EXISTS trg_validar_prestamo_antes_de_crear ON public.prestamos;
CREATE TRIGGER trg_validar_prestamo_antes_de_crear
BEFORE INSERT ON public.prestamos
FOR EACH ROW
EXECUTE FUNCTION public.validar_prestamo_antes_de_crear();

-- 6. Validación en base de datos al asignar equipo (superposición horaria y cupo por categoría)
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

  -- Bloquear la fila del equipo evita condiciones de carrera entre dos reservas simultáneas
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

    -- Validar cupo por categoría para estudiantes (sin roles exentos)
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
          AND r.nombre IN ('Pañol', 'Administrativo', 'Profesor Adjunto')
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

DROP TRIGGER IF EXISTS trg_validar_detalle_prestamo_antes_de_crear ON public.detalle_prestamos;
CREATE TRIGGER trg_validar_detalle_prestamo_antes_de_crear
BEFORE INSERT ON public.detalle_prestamos
FOR EACH ROW
EXECUTE FUNCTION public.validar_detalle_prestamo_antes_de_crear();
