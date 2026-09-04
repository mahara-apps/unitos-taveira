-- =============================================================================
-- 000_extensions.sql — EXTENSOES DO ESTADO ATUAL (aplicar ANTES de 001)
--
-- Motivo de existir: pg_dump --schema=public NAO emite CREATE EXTENSION para
-- extensoes cujo schema-alvo nao esta no dump (extensions, vault, pg_catalog),
-- nem para as instaladas em public quando dumpadas isoladamente. Portanto o
-- 001_initial_schema.sql referencia public.vector(1536) / hnsw sem criar a
-- extensao. Este arquivo NAO e reconstrucao aproximada: e a copia literal de
-- pg_extension do banco de origem (nome + schema + versao real).
--
-- Estado real lido em 2026-08-29 (SELECT em pg_extension, somente leitura):
--   pg_cron            pg_catalog   1.6.4
--   pg_net             public       0.20.3
--   pg_stat_statements extensions   1.11
--   pgcrypto           extensions   1.3
--   plpgsql            pg_catalog   1.0
--   supabase_vault     vault        0.3.1
--   uuid-ossp          extensions   1.1
--   vector             public       0.8.2
--
-- plpgsql ja vem pronto em qualquer projeto Supabase novo.
-- supabase_vault e criado explicitamente abaixo porque 001 depende dele
-- (public.cron_secret() / public.set_cron_secret() usam vault.*).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS pgcrypto      WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"   WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;

-- Vault: necessario para o segredo do cron (public.cron_secret()).
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- pgvector instalado em public no banco de origem: o 001 referencia
-- public.vector e public.vector_cosine_ops, logo o schema NAO pode mudar.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- pg_net registrado com schema public no banco de origem, mas a propria extensao
-- cria o schema "net": as funcoes ficam em net.http_post/net.http_get, que e como
-- 002_bootstrap_cron.sql as chama.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA public;

-- pg_cron sempre em pg_catalog no Supabase.
CREATE EXTENSION IF NOT EXISTS pg_cron;
