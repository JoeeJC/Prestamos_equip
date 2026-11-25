/*
# Trigger para liberar equipos automáticamente al cancelar o marcar No Presentado un préstamo

Resumen:
- Cuando un préstamo cambia de estado desde 'Reservado' o 'En Curso' hacia 'Cancelado' o 'No Presentado',
  este trigger libera automáticamente los equipos asociados en `detalle_prestamos` dejándolos en 'Disponible'.
- Solo libera equipos que actualmente están en 'Reservado' o 'En préstamo' (nunca sobrescribe 'En mantenimiento' ni 'Baja').
- Verifica que el equipo no tenga otra reserva/préstamo activo ('Reservado' o 'En Curso') distinto al que se cancela.
*/

CREATE OR REPLACE FUNCTION liberar_equipos_al_cancelar_prestamo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.estado IN ('Cancelado', 'No Presentado')
     AND OLD.estado IN ('Reservado', 'En Curso') THEN
    UPDATE equipos e
    SET estado = 'Disponible'
    FROM detalle_prestamos d
    WHERE d.id_prestamo = NEW.id_prestamo
      AND e.id_equipo = d.id_equipo
      AND e.estado IN ('Reservado', 'En préstamo')
      AND NOT EXISTS (
        SELECT 1
        FROM detalle_prestamos d2
        JOIN prestamos p2 ON p2.id_prestamo = d2.id_prestamo
        WHERE d2.id_equipo = e.id_equipo
          AND p2.id_prestamo <> NEW.id_prestamo
          AND p2.estado IN ('Reservado', 'En Curso')
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_liberar_equipos_al_cancelar_prestamo ON prestamos;

CREATE TRIGGER trg_liberar_equipos_al_cancelar_prestamo
AFTER UPDATE OF estado ON prestamos
FOR EACH ROW
WHEN (OLD.estado IS DISTINCT FROM NEW.estado)
EXECUTE FUNCTION liberar_equipos_al_cancelar_prestamo();
