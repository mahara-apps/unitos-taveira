-- V7 — social_posts_status_check: aceitar o status 'blocked'
--
-- Contexto: public.block_unusable_scheduled_social_posts() (via
-- public.mark_social_post_blocked()) grava status = 'blocked' em
-- public.social_posts, mas a CHECK social_posts_status_check só permite
-- ('draft','scheduled','publishing','published','failed','cancelled').
-- Resultado: o sweep fail-closed aborta com violação de CHECK e agendamentos
-- com destino inutilizável permanecem em 'scheduled'.
--
-- Escopo desta migration: SOMENTE a CHECK de status desta tabela.
-- - preserva o nome social_posts_status_check;
-- - preserva exatamente os 6 status já válidos, na mesma ordem;
-- - adiciona apenas 'blocked';
-- - não altera RLS, policies, grants, triggers, colunas, tabelas, funções
--   canônicas, a implementação de block_unusable_scheduled_social_posts()
--   nem regras de multi-tenant;
-- - não altera dados existentes (nenhum UPDATE/INSERT/DELETE).

ALTER TABLE public.social_posts
  DROP CONSTRAINT IF EXISTS social_posts_status_check;

ALTER TABLE public.social_posts
  ADD CONSTRAINT social_posts_status_check
  CHECK (status = ANY (ARRAY[
    'draft'::text,
    'scheduled'::text,
    'publishing'::text,
    'published'::text,
    'failed'::text,
    'cancelled'::text,
    'blocked'::text
  ]));