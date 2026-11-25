-- ============================================================================
-- Migración incremental: Código corto de retiro de 4 caracteres
-- Formato: 4 caracteres (1 letra al principio o al final + 3 dígitos)
-- Mantiene exclusión de caracteres ambiguos (sin 0/O ni 1/I)
-- ============================================================================

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

-- Actualizar reservas/préstamos activos al nuevo formato de 4 caracteres
UPDATE prestamos
SET codigo_retiro = public.generar_codigo_retiro()
WHERE estado IN ('Reservado', 'En Curso')
  AND (
    codigo_retiro IS NULL
    OR codigo_retiro !~ '^([A-Z][0-9]{3}|[0-9]{3}[A-Z])$'
  );
