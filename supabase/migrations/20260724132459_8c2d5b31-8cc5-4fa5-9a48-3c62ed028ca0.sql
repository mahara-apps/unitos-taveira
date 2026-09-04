-- =========================================
-- monthly_plans
-- =========================================
CREATE TABLE public.monthly_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  input_theme text,
  input_briefing_id uuid REFERENCES public.brand_briefings(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  objectives text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','archived')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_monthly_plans_brand ON public.monthly_plans(brand_id);
CREATE INDEX idx_monthly_plans_status ON public.monthly_plans(brand_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_plans TO authenticated;
GRANT ALL ON public.monthly_plans TO service_role;

ALTER TABLE public.monthly_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Brand members can read monthly_plans"
  ON public.monthly_plans FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brand_members bm
    WHERE bm.brand_id = monthly_plans.brand_id AND bm.user_id = auth.uid()
  ));

CREATE POLICY "Brand members can insert monthly_plans"
  ON public.monthly_plans FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.brand_members bm
    WHERE bm.brand_id = monthly_plans.brand_id AND bm.user_id = auth.uid()
  ));

CREATE POLICY "Brand members can update monthly_plans"
  ON public.monthly_plans FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brand_members bm
    WHERE bm.brand_id = monthly_plans.brand_id AND bm.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.brand_members bm
    WHERE bm.brand_id = monthly_plans.brand_id AND bm.user_id = auth.uid()
  ));

CREATE POLICY "Brand members can delete monthly_plans"
  ON public.monthly_plans FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brand_members bm
    WHERE bm.brand_id = monthly_plans.brand_id AND bm.user_id = auth.uid()
  ));

CREATE TRIGGER trg_monthly_plans_updated_at
  BEFORE UPDATE ON public.monthly_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- monthly_plan_topics
-- =========================================
CREATE TABLE public.monthly_plan_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monthly_plan_id uuid NOT NULL REFERENCES public.monthly_plans(id) ON DELETE CASCADE,
  topic_title text NOT NULL,
  content_format text,
  angle text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_monthly_plan_topics_plan ON public.monthly_plan_topics(monthly_plan_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_plan_topics TO authenticated;
GRANT ALL ON public.monthly_plan_topics TO service_role;

ALTER TABLE public.monthly_plan_topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Brand members can read monthly_plan_topics"
  ON public.monthly_plan_topics FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.monthly_plans mp
    JOIN public.brand_members bm ON bm.brand_id = mp.brand_id
    WHERE mp.id = monthly_plan_topics.monthly_plan_id AND bm.user_id = auth.uid()
  ));

CREATE POLICY "Brand members can insert monthly_plan_topics"
  ON public.monthly_plan_topics FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.monthly_plans mp
    JOIN public.brand_members bm ON bm.brand_id = mp.brand_id
    WHERE mp.id = monthly_plan_topics.monthly_plan_id AND bm.user_id = auth.uid()
  ));

CREATE POLICY "Brand members can update monthly_plan_topics"
  ON public.monthly_plan_topics FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.monthly_plans mp
    JOIN public.brand_members bm ON bm.brand_id = mp.brand_id
    WHERE mp.id = monthly_plan_topics.monthly_plan_id AND bm.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.monthly_plans mp
    JOIN public.brand_members bm ON bm.brand_id = mp.brand_id
    WHERE mp.id = monthly_plan_topics.monthly_plan_id AND bm.user_id = auth.uid()
  ));

CREATE POLICY "Brand members can delete monthly_plan_topics"
  ON public.monthly_plan_topics FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.monthly_plans mp
    JOIN public.brand_members bm ON bm.brand_id = mp.brand_id
    WHERE mp.id = monthly_plan_topics.monthly_plan_id AND bm.user_id = auth.uid()
  ));

CREATE TRIGGER trg_monthly_plan_topics_updated_at
  BEFORE UPDATE ON public.monthly_plan_topics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- posts: rastreio de origem na pauta
-- =========================================
ALTER TABLE public.posts
  ADD COLUMN monthly_plan_topic_id uuid REFERENCES public.monthly_plan_topics(id) ON DELETE SET NULL;

CREATE INDEX idx_posts_monthly_plan_topic ON public.posts(monthly_plan_topic_id);
