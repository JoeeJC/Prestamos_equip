-- ============================================================================
-- Migración incremental: Código de retiro / QR para entrega confirmada por ambas partes
-- Ejecutar en Supabase -> SQL Editor -> New query -> Run
-- ============================================================================

-- 1. Nuevas columnas en prestamos
ALTER TABLE prestamos
  ADD COLUMN IF NOT EXISTS codigo_retiro text,
  ADD COLUMN IF NOT EXISTS metodo_entrega text
    CHECK (metodo_entrega IN ('manual', 'qr', 'codigo'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_prestamos_codigo_retiro
  ON prestamos (codigo_retiro)
  WHERE codigo_retiro IS NOT NULL;

-- 2. Generador de código corto legible (6 caracteres sin caracteres confusos: sin 0/O, 1/I/L)
CREATE OR REPLACE FUNCTION public.generar_codigo_retiro()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_chars text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_code text;
  v_i integer;
BEGIN
  LOOP
    v_code := '';
    FOR v_i IN 1..6 LOOP
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::integer, 1);
    END LOOP;

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM prestamos WHERE codigo_retiro = v_code
    );
  END LOOP;

  RETURN v_code;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generar_codigo_retiro() FROM PUBLIC, anon, authenticated;

-- 3. Trigger para asignar automáticamente código de retiro al crear préstamo/reserva
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

-- Backfill para reservas pendientes existentes que aún no tienen código
UPDATE prestamos
SET codigo_retiro = public.generar_codigo_retiro()
WHERE codigo_retiro IS NULL
  AND estado IN ('Reservado', 'En Curso');

-- 4. RPC segura para que Pañol/Administrativo busque una reserva por QR o código corto
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
    'hora_retiro_real', p.hora_retiro_real,
    'hora_devolucion_real', p.hora_devolucion_real,
    'estado', p.estado,
    'codigo_retiro', p.codigo_retiro,
    'metodo_entrega', p.metodo_entrega,
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
