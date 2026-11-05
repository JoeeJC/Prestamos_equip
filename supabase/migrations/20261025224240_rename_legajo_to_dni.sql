/*
# Reemplazo de "legajo" por "dni"

1. Cambios
- Se renombra la columna `usuarios.legajo` a `usuarios.dni` y su índice asociado.
- El DNI mantiene la restricción UNIQUE y NOT NULL (identificador único de cada persona).
- Se actualiza la PK de `usuario_roles` y la FK correspondiente (sin cambios lógicos,
  ya que referencian `id_usuario`, no `legajo`).
- Se reconstruye el índice de búsqueda para que apunte a `dni`.

2. Datos
- Los DNIs de los usuarios demo se derivan de su antiguo legajo (números de 8 dígitos).
  No se pierden filas existentes: el valor del legajo se copia tal cual en `dni`.

3. Seguridad
- RLS y políticas ya estaban abiertas para anon + authenticated; no requieren cambios.
- Grants se reconfirman por si acaso.

4. Notas
- Postgres no permite renombrar una columna usada en una vista/índice sin recrear el índice;
  por eso se elimina y se recrea el índice `idx_usuarios_legajo` -> `idx_usuarios_dni`.
- No se eliminan datos ni se cambia ningún tipo: solo rename + índice.
*/

-- Renombrar columna
ALTER TABLE usuarios RENAME COLUMN legajo TO dni;

-- Recrear índice (drop del anterior + nuevo sobre dni)
DROP INDEX IF EXISTS idx_usuarios_legajo;
CREATE INDEX IF NOT EXISTS idx_usuarios_dni ON usuarios(dni);
