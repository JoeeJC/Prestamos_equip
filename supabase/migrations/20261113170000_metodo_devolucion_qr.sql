-- ============================================================================
-- Migración incremental: Confirmación de devolución por QR/código
-- Ejecutar en Supabase -> SQL Editor -> New query -> Run
-- ============================================================================

-- 1. Columna para registrar método de devolución
ALTER TABLE prestamos
  ADD COLUMN IF NOT EXISTS metodo_devolucion text
    CHECK (metodo_devolucion IN ('manual', 'qr', 'codigo'));

-- 2. Actualizar RPC de búsqueda por código para incluir metodo_devolucion
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
