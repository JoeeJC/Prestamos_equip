/*
# Configurable notebook limit for students

Plain-English summary
- Adds a settings table so the maximum number of notebooks a student can hold at once
  (Reservado or En Curso) is stored in the database instead of being hard-coded.
- Default value is 2, which matches the current rule.
- Adds a function that changes the limit. It only works for users with the Pañol or
  Administrativo role who re-enter their password, so students and teachers cannot change it.

New table
- `configuracion_sistema`: key (`clave`), value (`valor`, text), description and last update time.

New function
- `actualizar_limite_notebooks(p_id_usuario, p_password, p_valor)`: validates the value
  (1 to 20), checks the user exists, is not Inactivo, has the Pañol or Administrativo role and
  the password matches, then updates the limit and returns the new value.

Security changes
- RLS is enabled on `configuracion_sistema`.
- Everyone (anon and authenticated) can SELECT it, so students can read the limit.
- No INSERT, UPDATE or DELETE is granted on the table; changes go only through the function.
- The function is SECURITY DEFINER with a fixed search_path. EXECUTE is revoked from PUBLIC
  and granted to anon and authenticated, because the app uses the anon key.

Important notes
1. The seed row uses ON CONFLICT DO NOTHING, so re-running this migration never resets a changed limit.
2. The function does not modify any reservations; it only changes the setting.
*/

CREATE TABLE IF NOT EXISTS configuracion_sistema (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  descripcion TEXT,
  actualizado_el TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE configuracion_sistema ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON configuracion_sistema TO anon, authenticated;

DROP POLICY IF EXISTS "configuracion_sistema_select" ON configuracion_sistema;
CREATE POLICY "configuracion_sistema_select" ON configuracion_sistema
  FOR SELECT TO anon, authenticated USING (true);

INSERT INTO configuracion_sistema (clave, valor, descripcion)
VALUES (
  'limite_notebooks_alumno',
  '2',
  'Cantidad máxima de notebooks que un estudiante puede tener activas simultáneamente'
)
ON CONFLICT (clave) DO NOTHING;

CREATE OR REPLACE FUNCTION actualizar_limite_notebooks(
  p_id_usuario uuid,
  p_password text,
  p_valor integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_autorizado boolean;
BEGIN
  IF p_valor IS NULL OR p_valor < 1 OR p_valor > 20 THEN
    RAISE EXCEPTION 'El límite debe ser un número entre 1 y 20';
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

  UPDATE configuracion_sistema
  SET valor = p_valor::text, actualizado_el = NOW()
  WHERE clave = 'limite_notebooks_alumno';

  RETURN p_valor;
END;
$$;

REVOKE EXECUTE ON FUNCTION actualizar_limite_notebooks(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION actualizar_limite_notebooks(uuid, text, integer) TO anon, authenticated;
