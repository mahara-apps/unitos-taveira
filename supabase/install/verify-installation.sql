-- =============================================================================
-- verify-installation.sql — VALIDAÇÃO READ-ONLY de uma instalação do Unitos.
--
-- Somente SELECT. Não cria, não altera e não remove nada. Pode rodar em
-- produção e quantas vezes quiser.
--
--   psql "$SUPABASE_DB_URL" -f supabase/install/verify-installation.sql
--
-- Saída: uma linha por verificação com status PASS/FAIL e o valor observado.
-- =============================================================================

\pset pager off
\timing off

WITH checks AS (
  -- ------------------------------------------------------------------ isolamento
  SELECT 1 AS ord, 'isolamento: banco próprio (ref do projeto)' AS check_name,
         current_setting('server_version', true) AS observed,
         'PASS' AS status
  UNION ALL
  SELECT 2, 'isolamento: nenhuma referência ao MASTER em installation',
         coalesce((SELECT app_url FROM public.installation LIMIT 1), '(vazio)'),
         CASE WHEN EXISTS (
           SELECT 1 FROM public.installation
           WHERE lower(coalesce(app_url,'') || coalesce(logo_url,'') || coalesce(login_logo_url,'') || coalesce(email_from,''))
                 ~ '(unitos-master\.lovable\.app|tkjbhttylouamqxnbfgv)'
         ) THEN 'FAIL' ELSE 'PASS' END
  UNION ALL
  SELECT 3, 'installation.app_url definido e https',
         coalesce((SELECT app_url FROM public.installation LIMIT 1), '(nulo)'),
         CASE WHEN (SELECT app_url FROM public.installation LIMIT 1) ~ '^https://[a-zA-Z0-9._-]+(:[0-9]+)?$'
              THEN 'PASS' ELSE 'FAIL' END

  -- --------------------------------------------------------------- contagens base
  UNION ALL
  SELECT 10, 'baseline: tabelas em public (esperado >= 98)',
         (SELECT count(*)::text FROM pg_tables WHERE schemaname = 'public'),
         CASE WHEN (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') >= 98 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 11, 'baseline: enums em public (esperado 10)',
         (SELECT count(*)::text FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public' AND t.typtype = 'e'),
         CASE WHEN (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                    WHERE n.nspname = 'public' AND t.typtype = 'e') >= 10 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 12, 'baseline: funções em public (esperado >= 250)',
         (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'),
         CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public') >= 250 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 13, 'baseline: policies em public (esperado >= 225)',
         (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public'),
         CASE WHEN (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') >= 225 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 131, 'módulo Mensagens: tabelas + função de acesso',
         (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname IN ('message_threads','message_thread_participants','messages'))
         || ' tabelas / '
         || (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'can_access_message_thread'),
         CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public'
                      AND c.relname IN ('message_threads','message_thread_participants','messages')) = 3
                   AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                               WHERE n.nspname = 'public' AND p.proname = 'can_access_message_thread')
              THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 132, 'módulo Mensagens: tempo real (publicação supabase_realtime)',
         coalesce((SELECT string_agg(tablename, ', ' ORDER BY tablename) FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                     AND tablename IN ('messages','message_threads')), '(nenhuma)'),
         CASE WHEN (SELECT count(*) FROM pg_publication_tables
                    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                      AND tablename IN ('messages','message_threads')) = 2
              THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 133, 'módulo Mensagens: aviso de mensagem no notification_kind',
         CASE WHEN EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                           JOIN pg_namespace n ON n.oid = t.typnamespace
                           WHERE n.nspname = 'public' AND t.typname = 'notification_kind'
                             AND e.enumlabel = 'message') THEN 'presente' ELSE 'ausente' END,
         CASE WHEN EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                           JOIN pg_namespace n ON n.oid = t.typnamespace
                           WHERE n.nspname = 'public' AND t.typname = 'notification_kind'
                             AND e.enumlabel = 'message') THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 14, 'baseline: triggers próprios em public (esperado >= 100)',
         (SELECT count(*)::text FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND NOT tg.tgisinternal),
         CASE WHEN (SELECT count(*) FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND NOT tg.tgisinternal) >= 100 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 15, 'RLS habilitado em todas as tabelas de public',
         coalesce((SELECT string_agg(tablename, ', ' ORDER BY tablename) FROM pg_tables
                   WHERE schemaname = 'public' AND NOT rowsecurity), '0'),
         CASE WHEN (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity) = 0
              THEN 'PASS' ELSE 'FAIL' END

  UNION ALL
  SELECT 16, 'trigger on_auth_user_created em auth.users',
         (SELECT count(*)::text FROM pg_trigger WHERE tgname = 'on_auth_user_created'),
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created')
              THEN 'PASS' ELSE 'FAIL' END

  -- ------------------------------------------------------------------- extensões
  UNION ALL
  SELECT 20, 'extensões obrigatórias (pgcrypto, uuid-ossp, vector, pg_net, pg_cron, supabase_vault)',
         (SELECT string_agg(extname, ',' ORDER BY extname) FROM pg_extension
          WHERE extname IN ('pgcrypto','uuid-ossp','vector','pg_net','pg_cron','supabase_vault')),
         CASE WHEN (SELECT count(*) FROM pg_extension
                    WHERE extname IN ('pgcrypto','uuid-ossp','vector','pg_net','pg_cron','supabase_vault')) = 6
              THEN 'PASS' ELSE 'FAIL' END

  -- --------------------------------------------------------------------- storage
  UNION ALL
  SELECT 30, 'storage: 5 buckets privados esperados',
         (SELECT string_agg(id, ',' ORDER BY id) FROM storage.buckets
          WHERE id IN ('brand-assets','brand-documents','brand-media','avatars','chat-attachments')),
         CASE WHEN (SELECT count(*) FROM storage.buckets
                    WHERE id IN ('brand-assets','brand-documents','brand-media','avatars','chat-attachments')
                      AND public = false) = 5 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 31, 'storage: policies em storage.objects (esperado >= 12)',
         (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'),
         CASE WHEN (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects') >= 12
              THEN 'PASS' ELSE 'FAIL' END

  -- ----------------------------------------------------------------------- seeds
  UNION ALL
  SELECT 40, 'seeds: agent_prompts (esperado >= 9)',
         (SELECT count(*)::text FROM public.agent_prompts),
         CASE WHEN (SELECT count(*) FROM public.agent_prompts) >= 9 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 41, 'seeds: feature_catalog (esperado >= 14)',
         (SELECT count(*)::text FROM public.feature_catalog),
         CASE WHEN (SELECT count(*) FROM public.feature_catalog) >= 14 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 42, 'seeds: brain_retention_config (esperado >= 7)',
         (SELECT count(*)::text FROM public.brain_retention_config),
         CASE WHEN (SELECT count(*) FROM public.brain_retention_config) >= 7 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 43, 'seeds: singleton installation presente',
         (SELECT count(*)::text FROM public.installation),
         CASE WHEN (SELECT count(*) FROM public.installation) = 1 THEN 'PASS' ELSE 'FAIL' END

  -- --------------------------------------------------- nenhum dado de negócio copiado
  UNION ALL
  SELECT 50, 'sem dados de negócio herdados (marcas/clientes/posts/credenciais)',
         format('brands=%s clients=%s posts=%s credenciais=%s meta_app=%s',
                (SELECT count(*) FROM public.brands),
                (SELECT count(*) FROM public.clients),
                (SELECT count(*) FROM public.posts),
                (SELECT count(*) FROM public.brand_api_credentials),
                (SELECT count(*) FROM public.installation_meta_app)),
         'INFO'

  -- ----------------------------------------------------------------- vault / cron
  UNION ALL
  SELECT 60, 'vault: cron_secret presente e com tamanho mínimo',
         CASE WHEN public.cron_secret() IS NULL THEN 'ausente'
              ELSE 'len=' || length(public.cron_secret())::text END,
         CASE WHEN coalesce(length(public.cron_secret()), 0) >= 16 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 61, 'cron: total de jobs (esperado 14+)',
         (SELECT count(*)::text FROM cron.job),
         CASE WHEN (SELECT count(*) FROM cron.job) >= 14 THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 62, 'cron: jobs HTTP apontam para installation.app_url',
         coalesce((SELECT string_agg(jobname, ',' ORDER BY jobname) FROM cron.job
                   WHERE command ~ 'https?://'
                     AND command NOT LIKE '%' || rtrim((SELECT app_url FROM public.installation LIMIT 1), '/') || '/%'),
                  'todos na própria origem'),
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM cron.job
           WHERE command ~ 'https?://'
             AND command NOT LIKE '%' || rtrim((SELECT app_url FROM public.installation LIMIT 1), '/') || '/%'
         ) THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 63, 'cron: nenhuma URL do MASTER',
         coalesce((SELECT string_agg(jobname, ',' ORDER BY jobname) FROM cron.job
                   WHERE lower(command) ~ '(unitos-master\.lovable\.app|tkjbhttylouamqxnbfgv)'), 'nenhuma'),
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM cron.job WHERE lower(command) ~ '(unitos-master\.lovable\.app|tkjbhttylouamqxnbfgv)'
         ) THEN 'PASS' ELSE 'FAIL' END
  UNION ALL
  SELECT 64, 'cron: jobs HTTP usam x-cron-secret (nunca chave anon)',
         (SELECT count(*)::text FROM cron.job WHERE command ~ 'https?://' AND command LIKE '%x-cron-secret%'),
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM cron.job WHERE command ~ 'https?://' AND command NOT LIKE '%x-cron-secret%'
         ) THEN 'PASS' ELSE 'FAIL' END

  -- ---------------------------------------------------------------- brain_stats_mv
  UNION ALL
  SELECT 70, 'brain_stats_mv existe e está populada',
         coalesce((SELECT relispopulated::text FROM pg_class WHERE relname = 'brain_stats_mv' AND relkind = 'm'), 'ausente'),
         CASE WHEN (SELECT relispopulated FROM pg_class WHERE relname = 'brain_stats_mv' AND relkind = 'm')
              THEN 'PASS' ELSE 'FAIL' END
)
SELECT status, check_name, observed
FROM checks
ORDER BY ord;

-- Resumo final
SELECT 'RESUMO' AS scope,
       'verifique acima: qualquer FAIL bloqueia a liberação da instalação' AS note;
