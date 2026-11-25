/*
# Expire overdue reservations automatically

Plain-English summary
- Reservations that were never picked up are now released automatically. A reservation
  is overdue when its day has passed, or when it is today and its end time has already
  gone by (Argentina local time).
- Overdue reservations move from 'Reservado' to 'No Presentado'.
- Equipment that was held only by those overdue reservations goes back to 'Disponible'.
- Equipment that is also held by another active reservation ('Reservado' or 'En Curso')
  stays 'Reservado', so other people's bookings are never broken.
- Reservations already in 'En Curso' are never touched.

New function
- `cancelar_reservas_vencidas()` returns the number of reservations it expired.
- Runs as a single SQL statement, so either every change applies or none does.
- Callable from the app with `supabase.rpc('cancelar_reservas_vencidas')`.

Security changes
- EXECUTE is revoked from PUBLIC and granted to `anon` and `authenticated`, because the app
  runs with the anon key and calls this function from the catalog, admin and my-loans screens.
- No table grants or policies are changed.

Important notes
1. Time zone: the comparison uses 'America/Argentina/Buenos_Aires', not UTC.
2. The function has no tolerance window: a reservation expires as soon as its end time passes.
3. The function is idempotent: running it again when nothing is overdue changes nothing.
*/

CREATE OR REPLACE FUNCTION cancelar_reservas_vencidas()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ahora timestamp := now() AT TIME ZONE 'America/Argentina/Buenos_Aires';
  v_hoy date := v_ahora::date;
  v_hora time := v_ahora::time;
  v_total integer;
BEGIN
  WITH vencidos AS (
    SELECT p.id_prestamo
    FROM prestamos p
    WHERE p.estado = 'Reservado'
      AND (
        p.fecha_prestamo < v_hoy
        OR (p.fecha_prestamo = v_hoy AND p.hora_fin_prevista < v_hora)
      )
  ),
  equipos_liberables AS (
    SELECT DISTINCT d.id_equipo
    FROM detalle_prestamos d
    JOIN vencidos v ON v.id_prestamo = d.id_prestamo
    WHERE NOT EXISTS (
      SELECT 1
      FROM detalle_prestamos d2
      JOIN prestamos p2 ON p2.id_prestamo = d2.id_prestamo
      WHERE d2.id_equipo = d.id_equipo
        AND p2.estado IN ('Reservado', 'En Curso')
        AND p2.id_prestamo NOT IN (SELECT id_prestamo FROM vencidos)
    )
  ),
  equipos_actualizados AS (
    UPDATE equipos e
    SET estado = 'Disponible'
    FROM equipos_liberables l
    WHERE e.id_equipo = l.id_equipo
      AND e.estado = 'Reservado'
    RETURNING e.id_equipo
  ),
  prestamos_cancelados AS (
    UPDATE prestamos p
    SET estado = 'No Presentado'
    FROM vencidos v
    WHERE p.id_prestamo = v.id_prestamo
    RETURNING p.id_prestamo
  )
  SELECT count(*)::integer INTO v_total FROM prestamos_cancelados;

  RETURN COALESCE(v_total, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION cancelar_reservas_vencidas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancelar_reservas_vencidas() TO anon, authenticated;
