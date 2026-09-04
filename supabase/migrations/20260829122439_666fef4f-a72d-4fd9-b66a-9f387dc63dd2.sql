-- ETAPA 3 — desparticionar public.brain_events (transação única; rollback automático em falha)
DO $$
DECLARE
  before_count bigint;
  before_hash text;
  after_count bigint;
  after_hash text;
BEGIN
  SELECT count(*), md5(coalesce(string_agg(id::text, ',' ORDER BY id), ''))
    INTO before_count, before_hash FROM public.brain_events;

  -- 1) Nova tabela normal com PK simples
  CREATE TABLE public.brain_events_new (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    source_module text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    outcome_score numeric,
    created_at timestamptz NOT NULL DEFAULT now(),
    actor_id uuid,
    entity_type text,
    entity_id uuid,
    action text,
    client_id uuid,
    project_id uuid,
    confidence numeric,
    correlation_id uuid,
    processed_at timestamptz,
    CONSTRAINT brain_events_new_pkey PRIMARY KEY (id)
  );

  -- 2) Copiar dados (sem triggers ativos na nova tabela)
  INSERT INTO public.brain_events_new (
    id, brand_id, event_type, source_module, payload, outcome_score, created_at,
    actor_id, entity_type, entity_id, action, client_id, project_id,
    confidence, correlation_id, processed_at
  )
  SELECT id, brand_id, event_type, source_module, payload, outcome_score, created_at,
         actor_id, entity_type, entity_id, action, client_id, project_id,
         confidence, correlation_id, processed_at
    FROM public.brain_events;

  SELECT count(*), md5(coalesce(string_agg(id::text, ',' ORDER BY id), ''))
    INTO after_count, after_hash FROM public.brain_events_new;

  IF after_count <> before_count OR after_hash <> before_hash THEN
    RAISE EXCEPTION 'ETAPA 3 abortada: divergencia de dados (antes=% / depois=%, hash antes=% / depois=%)',
      before_count, after_count, before_hash, after_hash;
  END IF;

  -- 3) Trocar as tabelas
  DROP TABLE public.brain_events CASCADE;
  ALTER TABLE public.brain_events_new RENAME TO brain_events;
  ALTER TABLE public.brain_events RENAME CONSTRAINT brain_events_new_pkey TO brain_events_pkey;

  RAISE NOTICE 'ETAPA 3: % eventos consolidados', after_count;
END $$;

-- 4) Índices definidos na auditoria
CREATE INDEX brain_events_brand_created_idx ON public.brain_events USING btree (brand_id, created_at DESC);
CREATE INDEX brain_events_type_idx ON public.brain_events USING btree (event_type);
CREATE INDEX brain_events_unprocessed_idx ON public.brain_events USING btree (created_at) WHERE processed_at IS NULL;

-- 5) Grants + RLS equivalentes
GRANT SELECT, INSERT ON public.brain_events TO authenticated;
GRANT ALL ON public.brain_events TO service_role;

ALTER TABLE public.brain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_events FORCE ROW LEVEL SECURITY;

CREATE POLICY "brain_events_part_select" ON public.brain_events
  FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.client_in_scope(client_id, brand_id));

CREATE POLICY "brain_events_part_insert" ON public.brain_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.client_in_scope(client_id, brand_id)
    AND (actor_id IS NULL OR actor_id = auth.uid())
    AND created_at >= (now() - interval '2 minutes')
    AND created_at <= (now() + interval '2 minutes')
  );

-- 6) Triggers preservados (identidade + enqueue do Learning)
CREATE TRIGGER trg_brain_events_guard_identity
  BEFORE INSERT ON public.brain_events
  FOR EACH ROW EXECUTE FUNCTION public.brain_events_guard_identity();

CREATE TRIGGER trg_brain_events_enqueue_learning
  AFTER INSERT ON public.brain_events
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_brain_event_for_learning();

COMMENT ON TABLE public.brain_events IS
  'Barramento de eventos do Brain. Tabela unica (nao particionada) desde a ETAPA 3 da simplificacao.';

-- 7) Retenção sem particionamento
CREATE OR REPLACE FUNCTION public.brain_events_prune()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  hot_days int := public._brain_cfg_days('brain_events_hot_days', 90);
  cutoff timestamptz := now() - (hot_days || ' days')::interval;
  deleted int;
BEGIN
  WITH d AS (
    DELETE FROM public.brain_events WHERE created_at < cutoff RETURNING 1
  ) SELECT count(*) INTO deleted FROM d;
  RETURN jsonb_build_object('deleted', deleted, 'cutoff', cutoff);
END $function$;

REVOKE ALL ON FUNCTION public.brain_events_prune() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.brain_events_prune() FROM anon;
REVOKE ALL ON FUNCTION public.brain_events_prune() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.brain_events_prune() TO service_role;

CREATE OR REPLACE FUNCTION public.brain_retention_run()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE a jsonb; b jsonb;
BEGIN
  a := public.brain_events_prune();
  b := public.brain_cleanup_ttl();
  RETURN jsonb_build_object('events', a, 'ttl', b, 'ran_at', now());
END $function$;

-- 8) Mecanismos exclusivos de particionamento
DROP FUNCTION IF EXISTS public.brain_ensure_event_partitions(integer, integer);
DROP FUNCTION IF EXISTS public.brain_archive_and_prune_events();
DROP FUNCTION IF EXISTS public.brain_apply_partition_policies(text);

DELETE FROM public.brain_retention_config WHERE key = 'brain_events_archive_days';