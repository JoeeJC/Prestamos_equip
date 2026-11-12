REVOKE ALL ON usuarios FROM anon, authenticated;
GRANT SELECT (id_usuario, dni, nombre, apellido, email, estado) ON usuarios TO anon, authenticated;

REVOKE INSERT, UPDATE, DELETE ON usuario_roles FROM anon, authenticated;

REVOKE ALL ON sesiones_usuario FROM anon, authenticated;
