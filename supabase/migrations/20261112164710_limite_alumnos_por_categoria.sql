/*
# Per-category reservation limits for students

Plain-English summary
- Each equipment category can now have its own maximum number of items a student may hold at once
  (reserved or in use). Categories with no limit keep the value NULL, which means "Sin límite".
- Notebook starts at 2. If the earlier global limit setting exists, its value is carried over to Notebook.
- Only the Pañol or Administrativo roles can change a category limit, through a function that
  re-checks their password and role.

Changes
- `categorias_equipo.limite_alumnos` (integer, nullable): maximum items per student; NULL = no limit.
- Function `actualizar_limite_categoria(p_id_usuario, p_password, p_id_categoria, p_limite)`:
  sets or clears the limit for one category. Accepts 1 to 50, or NULL for "Sin límite".
- Function `actualizar_limite_notebooks` (the earlier global version) is removed, because it is replaced.

Security changes
- Direct updates to `categorias_equipo` through the API are restricted to the `nombre` and `descripcion` columns,
  so nobody can change `limite_alumnos` without going through the function.
- Direct inserts are restricted to `nombre` and `descripcion`; the new column keeps its NULL default.
- The new function is SECURITY DEFINER with a fixed search_path. EXECUTE is revoked from PUBLIC
  and granted to anon and authenticated, because the app uses the anon key; it checks password and role itself.

Important notes
1. The table `configuracion_sistema` from the previous step is no longer read by the app. It is kept, not dropped, so no data is lost.
2. Re-running this migration is safe: the Notebook value is only set when it is still NULL.
*/

ALTER TABLE categorias_equipo
  ADD COLUMN IF NOT EXISTS limite_alumnos INT DEFAULT NULL;

UPDATE categorias_equipo
SET limite_alumnos = COALESCE(
  (SELECT c.valor::int FROM configuracion_sistema c WHERE c.clave = 'limite_notebooks_alumno'),
  2
)
WHERE nombre = 'Notebook' AND limite_alumnos IS NULL;

REVOKE UPDATE ON categorias_equipo FROM anon, authenticated;
GRANT UPDATE (nombre, descripcion) ON categorias_equipo TO anon, authenticated;

REVOKE INSERT ON categorias_equipo FROM anon, authenticated;
GRANT INSERT (nombre, descripcion) ON categorias_equipo TO anon, authenticated;

DROP FUNCTION IF EXISTS actualizar_limite_notebooks(uuid, text, integer);

CREATE OR REPLACE FUNCTION actualizar_limite_categoria(
  p_id_usuario uuid,
  p_password text,
  p_id_categoria uuid,
  p_limite integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_autorizado boolean;
BEGIN
  IF p_limite IS NOT NULL AND (p_limite < 1 OR p_limite > 50) THEN
    RAISE EXCEPTION 'El límite debe estar entre 1 y 50, o quedar sin límite';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM usuarios u
    JOIN usuario_roles ur ON ur.id_usuario = u.id_usuario
    JOIN roles r ON r.id_rol = ur.id_rol
    WHERE u.id_usuario = p_id_usuario
      AND u.password_hash = p_password
      AND u.estado <> 'Inactivo'
      AND r.nombre IN ('Pañol', 'Administrativo')
  ) INTO v_autorizado;

  IF NOT v_autorizado THEN
    RAISE EXCEPTION 'No tenés permisos para modificar el límite o la contraseña es incorrecta';
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

REVOKE EXECUTE ON FUNCTION actualizar_limite_categoria(uuid, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION actualizar_limite_categoria(uuid, text, uuid, integer) TO anon, authenticated;
