
-- 1. brand_briefings
CREATE TABLE public.brand_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  raw_text text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  completude int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_briefings TO authenticated;
GRANT ALL ON public.brand_briefings TO service_role;
ALTER TABLE public.brand_briefings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand members access briefings"
  ON public.brand_briefings FOR ALL TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));
CREATE TRIGGER trg_brand_briefings_updated_at BEFORE UPDATE ON public.brand_briefings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. brand_voice_cards
CREATE TABLE public.brand_voice_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_voice_cards TO authenticated;
GRANT ALL ON public.brand_voice_cards TO service_role;
ALTER TABLE public.brand_voice_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand members access voice cards"
  ON public.brand_voice_cards FOR ALL TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));
CREATE TRIGGER trg_brand_voice_cards_updated_at BEFORE UPDATE ON public.brand_voice_cards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. brand_personas
CREATE TABLE public.brand_personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_personas TO authenticated;
GRANT ALL ON public.brand_personas TO service_role;
ALTER TABLE public.brand_personas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand members access personas"
  ON public.brand_personas FOR ALL TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));
CREATE TRIGGER trg_brand_personas_updated_at BEFORE UPDATE ON public.brand_personas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. brand_cohorts
CREATE TABLE public.brand_cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_cohorts TO authenticated;
GRANT ALL ON public.brand_cohorts TO service_role;
ALTER TABLE public.brand_cohorts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand members access cohorts"
  ON public.brand_cohorts FOR ALL TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));
CREATE TRIGGER trg_brand_cohorts_updated_at BEFORE UPDATE ON public.brand_cohorts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. brand_swot
CREATE TABLE public.brand_swot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_swot TO authenticated;
GRANT ALL ON public.brand_swot TO service_role;
ALTER TABLE public.brand_swot ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand members access swot"
  ON public.brand_swot FOR ALL TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));
CREATE TRIGGER trg_brand_swot_updated_at BEFORE UPDATE ON public.brand_swot
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. brand_pautas
CREATE TABLE public.brand_pautas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  pilar text,
  cohort_alvo text,
  formato_recomendado text,
  plataforma text,
  gancho text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_pautas TO authenticated;
GRANT ALL ON public.brand_pautas TO service_role;
ALTER TABLE public.brand_pautas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand members access pautas"
  ON public.brand_pautas FOR ALL TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));
CREATE TRIGGER trg_brand_pautas_updated_at BEFORE UPDATE ON public.brand_pautas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7. brand_competitors
CREATE TABLE public.brand_competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  handle text,
  bio_colada text,
  posts_colados text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  pautas_inspiradas jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_competitors TO authenticated;
GRANT ALL ON public.brand_competitors TO service_role;
ALTER TABLE public.brand_competitors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand members access competitors"
  ON public.brand_competitors FOR ALL TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));
CREATE TRIGGER trg_brand_competitors_updated_at BEFORE UPDATE ON public.brand_competitors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8. brand_ai_content
CREATE TABLE public.brand_ai_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,
  pauta_id uuid REFERENCES public.brand_pautas(id) ON DELETE SET NULL,
  plataforma text,
  formato text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_ai_content TO authenticated;
GRANT ALL ON public.brand_ai_content TO service_role;
ALTER TABLE public.brand_ai_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand members access ai content"
  ON public.brand_ai_content FOR ALL TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));
CREATE TRIGGER trg_brand_ai_content_updated_at BEFORE UPDATE ON public.brand_ai_content
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 9. brand_ai_versions (histórico canônico)
CREATE TABLE public.brand_ai_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  entity_type text NOT NULL,          -- briefing | voice | personas | cohorts | swot
  entity_id uuid NOT NULL,
  data jsonb NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_brand_ai_versions_entity ON public.brand_ai_versions(entity_type, entity_id);
GRANT SELECT, INSERT ON public.brand_ai_versions TO authenticated;
GRANT ALL ON public.brand_ai_versions TO service_role;
ALTER TABLE public.brand_ai_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand members read versions"
  ON public.brand_ai_versions FOR SELECT TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()));
CREATE POLICY "brand members insert versions"
  ON public.brand_ai_versions FOR INSERT TO authenticated
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

-- 10. brand_ai_usage
CREATE TABLE public.brand_ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  agent text NOT NULL,
  model text NOT NULL,
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  cost_usd numeric(10,6) NOT NULL DEFAULT 0,
  success boolean NOT NULL DEFAULT true,
  error_message text,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_brand_ai_usage_brand_date ON public.brand_ai_usage(brand_id, created_at DESC);
GRANT SELECT ON public.brand_ai_usage TO authenticated;
GRANT ALL ON public.brand_ai_usage TO service_role;
ALTER TABLE public.brand_ai_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brand members read ai usage"
  ON public.brand_ai_usage FOR SELECT TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()));
