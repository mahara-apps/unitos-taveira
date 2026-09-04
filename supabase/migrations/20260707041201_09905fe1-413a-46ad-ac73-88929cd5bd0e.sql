-- 1. Adiciona client_id (NOT NULL, cascade) — todas as tabelas estão vazias
ALTER TABLE public.brand_briefings   ADD COLUMN client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.brand_voice_cards ADD COLUMN client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.brand_personas    ADD COLUMN client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.brand_cohorts     ADD COLUMN client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.brand_swot        ADD COLUMN client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.brand_pautas      ADD COLUMN client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.brand_competitors ADD COLUMN client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.brand_ai_content  ADD COLUMN client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE;
ALTER TABLE public.brand_ai_versions ADD COLUMN client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE;

-- 2. Índices por cliente
CREATE INDEX idx_brand_briefings_client   ON public.brand_briefings(client_id);
CREATE INDEX idx_brand_voice_cards_client ON public.brand_voice_cards(client_id);
CREATE INDEX idx_brand_personas_client    ON public.brand_personas(client_id);
CREATE INDEX idx_brand_cohorts_client     ON public.brand_cohorts(client_id);
CREATE INDEX idx_brand_swot_client        ON public.brand_swot(client_id);
CREATE INDEX idx_brand_pautas_client      ON public.brand_pautas(client_id);
CREATE INDEX idx_brand_competitors_client ON public.brand_competitors(client_id);
CREATE INDEX idx_brand_ai_content_client  ON public.brand_ai_content(client_id);
CREATE INDEX idx_brand_ai_versions_client ON public.brand_ai_versions(client_id);

-- 3. Substitui policies para exigir que o cliente pertença à mesma marca
-- brand_briefings
DROP POLICY IF EXISTS "brand members access briefings" ON public.brand_briefings;
CREATE POLICY "brand members access briefings" ON public.brand_briefings FOR ALL
  USING (
    is_brand_member(brand_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = brand_briefings.client_id AND c.brand_id = brand_briefings.brand_id)
  )
  WITH CHECK (
    is_brand_member(brand_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = brand_briefings.client_id AND c.brand_id = brand_briefings.brand_id)
  );

-- brand_voice_cards
DROP POLICY IF EXISTS "brand members access voice cards" ON public.brand_voice_cards;
CREATE POLICY "brand members access voice cards" ON public.brand_voice_cards FOR ALL
  USING (
    is_brand_member(brand_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = brand_voice_cards.client_id AND c.brand_id = brand_voice_cards.brand_id)
  )
  WITH CHECK (
    is_brand_member(brand_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = brand_voice_cards.client_id AND c.brand_id = brand_voice_cards.brand_id)
  );

-- brand_personas
DROP POLICY IF EXISTS "brand members access personas" ON public.brand_personas;
CREATE POLICY "brand members access personas" ON public.brand_personas FOR ALL
  USING (
    is_brand_member(brand_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = brand_personas.client_id AND c.brand_id = brand_personas.brand_id)
  )
  WITH CHECK (
    is_brand_member(brand_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = brand_personas.client_id AND c.brand_id = brand_personas.brand_id)
  );

-- brand_cohorts
DROP POLICY IF EXISTS "brand members access cohorts" ON public.brand_cohorts;
CREATE POLICY "brand members access cohorts" ON public.brand_cohorts FOR ALL
  USING (
    is_brand_member(brand_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = brand_cohorts.client_id AND c.brand_id = brand_cohorts.brand_id)
  )
  WITH CHECK (
    is_brand_member(brand_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = brand_cohorts.client_id AND c.brand_id = brand_cohorts.brand_id)
  );

-- brand_swot
DROP POLICY IF EXISTS "brand members access swot" ON public.brand_swot;
CREATE POLICY "brand members access swot" ON public.brand_swot FOR ALL
  USING (
    is_brand_member(brand_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = brand_swot.client_id AND c.brand_id = brand_swot.brand_id)
  )
  WITH CHECK (
    is_brand_member(brand_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = brand_swot.client_id AND c.brand_id = brand_swot.brand_id)
  );

-- brand_pautas
DROP POLICY IF EXISTS "brand members access pautas" ON public.brand_pautas;
CREATE POLICY "brand members access pautas" ON public.brand_pautas FOR ALL
  USING (
    is_brand_member(brand_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = brand_pautas.client_id AND c.brand_id = brand_pautas.brand_id)
  )
  WITH CHECK (
    is_brand_member(brand_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = brand_pautas.client_id AND c.brand_id = brand_pautas.brand_id)
  );

-- brand_competitors
DROP POLICY IF EXISTS "brand members access competitors" ON public.brand_competitors;
CREATE POLICY "brand members access competitors" ON public.brand_competitors FOR ALL
  USING (
    is_brand_member(brand_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = brand_competitors.client_id AND c.brand_id = brand_competitors.brand_id)
  )
  WITH CHECK (
    is_brand_member(brand_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = brand_competitors.client_id AND c.brand_id = brand_competitors.brand_id)
  );

-- brand_ai_content
DROP POLICY IF EXISTS "brand members access ai content" ON public.brand_ai_content;
CREATE POLICY "brand members access ai content" ON public.brand_ai_content FOR ALL
  USING (
    is_brand_member(brand_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = brand_ai_content.client_id AND c.brand_id = brand_ai_content.brand_id)
  )
  WITH CHECK (
    is_brand_member(brand_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = brand_ai_content.client_id AND c.brand_id = brand_ai_content.brand_id)
  );

-- brand_ai_versions (2 policies: read + insert)
DROP POLICY IF EXISTS "brand members read versions" ON public.brand_ai_versions;
CREATE POLICY "brand members read versions" ON public.brand_ai_versions FOR SELECT
  USING (
    is_brand_member(brand_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = brand_ai_versions.client_id AND c.brand_id = brand_ai_versions.brand_id)
  );

DROP POLICY IF EXISTS "brand members insert versions" ON public.brand_ai_versions;
CREATE POLICY "brand members insert versions" ON public.brand_ai_versions FOR INSERT
  WITH CHECK (
    is_brand_member(brand_id, auth.uid())
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id = brand_ai_versions.client_id AND c.brand_id = brand_ai_versions.brand_id)
  );