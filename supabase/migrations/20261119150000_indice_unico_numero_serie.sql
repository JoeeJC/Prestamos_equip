-- ============================================================================
-- Migración: Índice único parcial para numero_serie en equipos
-- Permite NULL (equipos sin número de serie cargado aún), pero impide
-- duplicados no vacíos ignorando espacios y mayúsculas/minúsculas.
-- ============================================================================

UPDATE public.equipos
SET numero_serie = NULL
WHERE numero_serie IS NOT NULL
  AND btrim(numero_serie) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_equipos_numero_serie_unico
  ON public.equipos (upper(btrim(numero_serie)))
  WHERE numero_serie IS NOT NULL AND btrim(numero_serie) <> '';
