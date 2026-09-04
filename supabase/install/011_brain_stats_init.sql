-- =============================================================================
-- 011_brain_stats_init.sql — inicializa a materialized view brain_stats_mv.
-- Idempotente e não destrutivo: apenas popula/atualiza a matview do baseline.
-- Deve rodar DEPOIS do 001 (a matview nasce vazia e sem populate garantido).
-- =============================================================================

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_matviews WHERE schemaname = 'public' AND matviewname = 'brain_stats_mv'
  ) THEN
    RAISE EXCEPTION 'brain_stats_mv ausente: aplique 001_initial_schema.sql antes';
  END IF;

  -- Primeiro refresh não pode ser CONCURRENTLY (matview ainda não populada).
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'brain_stats_mv' AND relkind = 'm' AND relispopulated
  ) THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.brain_stats_mv;
  ELSE
    REFRESH MATERIALIZED VIEW public.brain_stats_mv;
  END IF;
END $$;

SELECT 'brain_stats_mv' AS item,
       (SELECT relispopulated FROM pg_class WHERE relname = 'brain_stats_mv' AND relkind = 'm') AS populated;
