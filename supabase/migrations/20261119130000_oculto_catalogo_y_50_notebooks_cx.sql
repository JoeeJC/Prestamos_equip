-- ============================================================================
-- Migración: campo oculto_catalogo en equipos + carga de 50 Notebooks CX reales
-- y eliminación de las 3 notebooks de ejemplo (NB-001, NB-002, NB-003).
-- ============================================================================

-- 1. Columna para ocultar equipos del catálogo público (siguen visibles para Admin)
ALTER TABLE public.equipos
  ADD COLUMN IF NOT EXISTS oculto_catalogo boolean NOT NULL DEFAULT false;

-- 2. Validar en trigger que no se reserven desde catálogo equipos ocultos
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
  v_eq_oculto      boolean;
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

  SELECT estado, codigo_inventario, id_categoria, COALESCE(oculto_catalogo, false)
  INTO v_eq_estado, v_eq_codigo, v_id_categoria, v_eq_oculto
  FROM public.equipos
  WHERE id_equipo = NEW.id_equipo
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El equipo seleccionado no existe';
  END IF;

  IF v_eq_estado IN ('En mantenimiento', 'Baja') THEN
    RAISE EXCEPTION 'El equipo % no está operativo (%)', v_eq_codigo, v_eq_estado;
  END IF;

  IF v_prestamo.estado = 'Reservado' AND v_eq_oculto THEN
    RAISE EXCEPTION 'El equipo % está oculto del catálogo y no puede reservarse por este medio', v_eq_codigo;
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

-- 3. Eliminar las 3 notebooks de ejemplo (NB-001, NB-002, NB-003)
DELETE FROM public.detalle_prestamos
WHERE id_equipo IN (
  SELECT id_equipo FROM public.equipos WHERE codigo_inventario IN ('NB-001', 'NB-002', 'NB-003')
);

DELETE FROM public.prestamos p
WHERE NOT EXISTS (
  SELECT 1 FROM public.detalle_prestamos d WHERE d.id_prestamo = p.id_prestamo
);

DELETE FROM public.equipos
WHERE codigo_inventario IN ('NB-001', 'NB-002', 'NB-003');

-- 4. Asegurar categoría Notebook
INSERT INTO public.categorias_equipo (nombre, descripcion, limite_alumnos)
VALUES ('Notebook', 'Laptop para uso académico', 2)
ON CONFLICT (nombre) DO NOTHING;

-- 5. Insertar o actualizar las 50 Notebooks CX reales (10778 a 10827)
INSERT INTO public.equipos (
  id_categoria,
  codigo_inventario,
  numero_serie,
  marca_modelo,
  estado,
  oculto_catalogo,
  observaciones
)
SELECT
  c.id_categoria,
  v.codigo_inventario,
  v.numero_serie,
  'Notebook CX',
  v.estado,
  v.oculto_catalogo,
  v.observaciones
FROM public.categorias_equipo c
CROSS JOIN (
  VALUES
    ('10778', 'CX30M1522081124', 'Disponible',       false, NULL),
    ('10779', 'CX30M1522081083', 'Disponible',       false, NULL),
    ('10780', 'CX30M1522081144', 'Disponible',       false, NULL),
    ('10781', 'CX30M1522081152', 'Disponible',       false, NULL),
    ('10782', 'CX30M1522081081', 'Disponible',       false, NULL),
    ('10783', 'CX30M1522081153', 'Disponible',       false, NULL),
    ('10784', 'CX30M1522081148', 'Disponible',       false, NULL),
    ('10785', 'CX30M1522081150', 'Disponible',       false, NULL),
    ('10786', 'CX30M1522081142', 'Disponible',       false, NULL),
    ('10787', 'CX30M1522081084', 'Disponible',       false, NULL),
    ('10788', 'CX30M1522081128', 'Disponible',       false, NULL),
    ('10789', 'CX30M1522081159', 'Disponible',       false, NULL),
    ('10790', 'CX30M1522081158', 'Disponible',       true,  'Administrac.'),
    ('10791', 'CX30M1522081156', 'Disponible',       false, NULL),
    ('10792', 'CX30M1522081157', 'Disponible',       false, NULL),
    ('10793', 'CX30M1522081119', 'Disponible',       false, NULL),
    ('10794', 'CX30M1522081098', 'Disponible',       false, NULL),
    ('10795', 'CX30M1522081101', 'Disponible',       false, NULL),
    ('10796', 'CX30M1522081125', 'Disponible',       false, NULL),
    ('10797', 'CX30M1522081117', 'Disponible',       false, NULL),
    ('10798', 'CX30M1522081139', 'Disponible',       false, NULL),
    ('10799', 'CX30M1522081136', 'Disponible',       false, NULL),
    ('10800', 'CX30M1522081137', 'Disponible',       false, NULL),
    ('10801', 'CX30M1522081180', 'Disponible',       false, NULL),
    ('10802', 'CX30M1522081120', 'Disponible',       false, NULL),
    ('10803', 'CX30M1522081131', 'Disponible',       false, NULL),
    ('10804', NULL,              'En mantenimiento', false, 'Municipio de Junin'),
    ('10805', 'CX30M1522081130', 'Disponible',       false, NULL),
    ('10806', 'CX30M1522081132', 'Disponible',       false, NULL),
    ('10807', 'CX30M1522081149', 'En mantenimiento', false, 'No enciende. Matias'),
    ('10808', 'CX30M1522081147', 'Disponible',       false, NULL),
    ('10809', 'CX30M1522081146', 'Disponible',       false, NULL),
    ('10810', 'CX30M1522081155', 'Disponible',       false, NULL),
    ('10811', 'CX30M1522081082', 'Disponible',       false, NULL),
    ('10812', 'CX30M1522081154', 'Disponible',       false, NULL),
    ('10813', 'CX30M1522081135', 'Disponible',       false, NULL),
    ('10814', NULL,              'En mantenimiento', false, 'Municipio de Junin'),
    ('10815', 'CX30M1522081134', 'Disponible',       false, NULL),
    ('10816', 'CX30M1522081161', 'Disponible',       false, NULL),
    ('10817', 'CX30M1522081138', 'Disponible',       false, NULL),
    ('10818', 'CX30M1522081151', 'Disponible',       false, NULL),
    ('10819', 'CX30M1522081143', 'Disponible',       false, NULL),
    ('10820', 'CX30M1522081140', 'Disponible',       false, NULL),
    ('10821', 'CX30M1522081160', 'Disponible',       false, NULL),
    ('10822', 'CX30M1522081183', 'Disponible',       false, NULL),
    ('10823', 'CX30M1522081108', 'Disponible',       false, NULL),
    ('10824', 'CX30M1522081075', 'Disponible',       true,  'uso profesores'),
    ('10825', 'CX30M1522081086', 'Disponible',       false, NULL),
    ('10826', 'CX30M1522081077', 'Disponible',       false, NULL),
    ('10827', 'CX30M1522081112', 'Disponible',       false, NULL)
) AS v(codigo_inventario, numero_serie, estado, oculto_catalogo, observaciones)
WHERE c.nombre = 'Notebook'
ON CONFLICT (codigo_inventario) DO UPDATE
SET
  id_categoria    = EXCLUDED.id_categoria,
  numero_serie    = EXCLUDED.numero_serie,
  marca_modelo    = EXCLUDED.marca_modelo,
  estado          = EXCLUDED.estado,
  oculto_catalogo = EXCLUDED.oculto_catalogo,
  observaciones   = EXCLUDED.observaciones;
