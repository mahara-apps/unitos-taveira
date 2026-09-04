-- 1) Backfill não destrutivo: legado -> clients.brand_hub (só preenche lacunas)
DO $$
DECLARE r record; hub jsonb; d jsonb; v text;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (b.client_id) b.client_id, b.brand_id, b.data, c.brand_hub
    FROM public.brand_briefings b
    JOIN public.clients c ON c.id = b.client_id
    ORDER BY b.client_id, b.created_at DESC
  LOOP
    hub := coalesce(r.brand_hub, '{}'::jsonb);
    d := coalesce(r.data, '{}'::jsonb);

    -- Campos de texto com mesma chave
    FOREACH v IN ARRAY ARRAY['description','mission','positioning','values','offer','price_range',
                             'differentials','objections','audience','journey','pain_points',
                             'desires','demographics','tone_text','goals']
    LOOP
      IF coalesce(btrim(hub->>v),'') = '' AND coalesce(btrim(d->>v),'') <> '' THEN
        hub := jsonb_set(hub, ARRAY[v], to_jsonb(btrim(d->>v)), true);
      END IF;
    END LOOP;

    -- Equivalências pt-BR
    IF coalesce(btrim(hub->>'audience'),'') = '' AND coalesce(btrim(d->>'publico_alvo'),'') <> '' THEN
      hub := jsonb_set(hub, ARRAY['audience'], to_jsonb(btrim(d->>'publico_alvo')), true);
    END IF;
    IF coalesce(btrim(hub->>'tone_text'),'') = '' AND coalesce(btrim(d->>'tom_de_voz'),'') <> '' THEN
      hub := jsonb_set(hub, ARRAY['tone_text'], to_jsonb(btrim(d->>'tom_de_voz')), true);
    END IF;
    IF coalesce(btrim(hub->>'pain_points'),'') = '' AND jsonb_typeof(d->'dores_do_cliente_final') = 'array' THEN
      SELECT string_agg(x, E'\n') INTO v FROM jsonb_array_elements_text(d->'dores_do_cliente_final') AS t(x) WHERE btrim(x) <> '';
      IF coalesce(v,'') <> '' THEN hub := jsonb_set(hub, ARRAY['pain_points'], to_jsonb(v), true); END IF;
    END IF;
    IF coalesce(btrim(hub->>'differentials'),'') = '' AND jsonb_typeof(d->'diferenciais') = 'array' THEN
      SELECT string_agg(x, E'\n') INTO v FROM jsonb_array_elements_text(d->'diferenciais') AS t(x) WHERE btrim(x) <> '';
      IF coalesce(v,'') <> '' THEN hub := jsonb_set(hub, ARRAY['differentials'], to_jsonb(v), true); END IF;
    END IF;
    IF coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(hub->'hashtags')='array' THEN hub->'hashtags' ELSE '[]'::jsonb END),0) = 0
       AND jsonb_typeof(d->'hashtags_sugeridas') = 'array' THEN
      hub := jsonb_set(hub, ARRAY['hashtags'], d->'hashtags_sugeridas', true);
    END IF;
    IF coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(hub->'competitors')='array' THEN hub->'competitors' ELSE '[]'::jsonb END),0) = 0
       AND jsonb_typeof(d->'concorrentes_mencionados') = 'array' THEN
      hub := jsonb_set(
        hub, ARRAY['competitors'],
        coalesce((SELECT jsonb_agg(jsonb_build_object('handle', x))
                  FROM jsonb_array_elements_text(d->'concorrentes_mencionados') AS t(x)
                  WHERE btrim(x) <> ''), '[]'::jsonb),
        true);
    END IF;

    UPDATE public.clients SET brand_hub = hub WHERE id = r.client_id;
  END LOOP;
END $$;

-- 2) Ciclo de status mínimo do briefing (no cliente)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS briefing_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS briefing_status_at timestamptz,
  ADD COLUMN IF NOT EXISTS briefing_status_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_briefing_status_check'
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_briefing_status_check
      CHECK (briefing_status IN ('draft','requested','submitted','in_review','approved'));
  END IF;
END $$;

-- 3) Versionamento/auditoria do briefing canônico
CREATE TABLE IF NOT EXISTS public.brand_briefing_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  completion integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  origin text NOT NULL DEFAULT 'manual',
  changed_fields text[] NOT NULL DEFAULT '{}',
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brand_briefing_versions_client
  ON public.brand_briefing_versions (client_id, created_at DESC);

GRANT SELECT, INSERT ON public.brand_briefing_versions TO authenticated;
GRANT ALL ON public.brand_briefing_versions TO service_role;

ALTER TABLE public.brand_briefing_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "briefing versions readable in scope" ON public.brand_briefing_versions;
CREATE POLICY "briefing versions readable in scope"
  ON public.brand_briefing_versions FOR SELECT TO authenticated
  USING (public.can_access_client(client_id, auth.uid()));

DROP POLICY IF EXISTS "briefing versions insert in scope" ON public.brand_briefing_versions;
CREATE POLICY "briefing versions insert in scope"
  ON public.brand_briefing_versions FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_client(client_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.brand_id = brand_id)
  );