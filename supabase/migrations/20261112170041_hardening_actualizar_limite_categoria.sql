/*
# Endurecer la función de límites por categoría

1. Cambios
- La función `actualizar_limite_categoria` pasa a fijar su search_path a `public, pg_temp`,
  evitando que objetos temporales de la sesión puedan sustituir funciones o tablas.
- Se revoca EXECUTE a PUBLIC y se vuelve a conceder explícitamente a anon y authenticated.

2. Seguridad
- La función sigue siendo SECURITY DEFINER y sigue validando dentro de la base de datos
  la contraseña, el estado del usuario y que tenga rol Pañol o Administrativo.
- No se cambia la firma ni la lógica de validación, para no romper el panel de límites.

3. Notas importantes
- La aplicación inicia sesión con su propia tabla de usuarios, no con Supabase Auth,
  por lo que las consultas se ejecutan como anon y auth.uid() es nulo.
- Por eso no se exige auth.uid() ni se quita EXECUTE a anon.
- Se puede usar IF/CREATE OR REPLACE de forma repetible.
*/

ALTER FUNCTION public.actualizar_limite_categoria(uuid, text, uuid, integer)
  SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.actualizar_limite_categoria(uuid, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actualizar_limite_categoria(uuid, text, uuid, integer) TO anon, authenticated;
