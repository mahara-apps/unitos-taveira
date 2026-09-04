
-- 1. content_pipelines
CREATE TABLE public.content_pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_pipelines TO authenticated;
GRANT ALL ON public.content_pipelines TO service_role;
ALTER TABLE public.content_pipelines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand members read pipelines"
  ON public.content_pipelines FOR SELECT TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()));
CREATE POLICY "brand members insert pipelines"
  ON public.content_pipelines FOR INSERT TO authenticated
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));
CREATE POLICY "brand members update pipelines"
  ON public.content_pipelines FOR UPDATE TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));
CREATE POLICY "brand members delete pipelines"
  ON public.content_pipelines FOR DELETE TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()));

CREATE TRIGGER update_content_pipelines_updated_at
  BEFORE UPDATE ON public.content_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. content_pipeline_stages
CREATE TABLE public.content_pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES public.content_pipelines(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  color text NOT NULL DEFAULT 'muted',
  position integer NOT NULL DEFAULT 0,
  is_terminal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_id, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_pipeline_stages TO authenticated;
GRANT ALL ON public.content_pipeline_stages TO service_role;
ALTER TABLE public.content_pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand members read stages"
  ON public.content_pipeline_stages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.content_pipelines p
    WHERE p.id = pipeline_id AND public.is_brand_member(p.brand_id, auth.uid())
  ));
CREATE POLICY "brand members write stages"
  ON public.content_pipeline_stages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.content_pipelines p
    WHERE p.id = pipeline_id AND public.is_brand_member(p.brand_id, auth.uid())
  ));
CREATE POLICY "brand members update stages"
  ON public.content_pipeline_stages FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.content_pipelines p
    WHERE p.id = pipeline_id AND public.is_brand_member(p.brand_id, auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.content_pipelines p
    WHERE p.id = pipeline_id AND public.is_brand_member(p.brand_id, auth.uid())
  ));
CREATE POLICY "brand members delete stages"
  ON public.content_pipeline_stages FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.content_pipelines p
    WHERE p.id = pipeline_id AND public.is_brand_member(p.brand_id, auth.uid())
  ));

CREATE TRIGGER update_content_pipeline_stages_updated_at
  BEFORE UPDATE ON public.content_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Posts: pipeline_id + stage_id + position
ALTER TABLE public.posts
  ADD COLUMN pipeline_id uuid REFERENCES public.content_pipelines(id) ON DELETE SET NULL,
  ADD COLUMN stage_id uuid REFERENCES public.content_pipeline_stages(id) ON DELETE SET NULL,
  ADD COLUMN position integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS posts_pipeline_stage_idx
  ON public.posts (pipeline_id, stage_id, position);

-- 4. Guarda: promover próximo pipeline a default se o default for excluído; se for único, bloquear
CREATE OR REPLACE FUNCTION public.protect_pipeline_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next uuid;
BEGIN
  IF OLD.is_default THEN
    SELECT id INTO v_next
      FROM public.content_pipelines
      WHERE client_id = OLD.client_id AND id <> OLD.id
      ORDER BY position ASC, created_at ASC
      LIMIT 1;
    IF v_next IS NULL THEN
      RAISE EXCEPTION 'cannot_delete_last_pipeline';
    END IF;
    UPDATE public.content_pipelines SET is_default = true WHERE id = v_next;
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER protect_default_pipeline
  BEFORE DELETE ON public.content_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.protect_pipeline_delete();

-- 5. Backfill: 1 pipeline default por cliente com posts + stages padrão
DO $$
DECLARE
  r_client RECORD;
  v_pipeline_id uuid;
  stage_defs jsonb := '[
    {"key":"briefing","label":"Ideia","color":"muted","pos":0},
    {"key":"writing","label":"Produção","color":"indigo","pos":1024},
    {"key":"design","label":"Design","color":"violet","pos":2048},
    {"key":"review","label":"Revisão","color":"amber","pos":3072},
    {"key":"approved","label":"Aprovado","color":"emerald","pos":4096},
    {"key":"scheduled","label":"Agendado","color":"sky","pos":5120}
  ]'::jsonb;
  s jsonb;
BEGIN
  FOR r_client IN
    SELECT DISTINCT c.id AS client_id, c.brand_id
    FROM public.clients c
    WHERE EXISTS (SELECT 1 FROM public.posts p WHERE p.client_id = c.id)
  LOOP
    INSERT INTO public.content_pipelines (brand_id, client_id, name, slug, is_default, position)
    VALUES (r_client.brand_id, r_client.client_id, 'Pipeline principal', 'main', true, 0)
    RETURNING id INTO v_pipeline_id;

    FOR s IN SELECT jsonb_array_elements(stage_defs) LOOP
      INSERT INTO public.content_pipeline_stages (pipeline_id, key, label, color, position, is_terminal)
      VALUES (
        v_pipeline_id,
        s->>'key',
        s->>'label',
        s->>'color',
        (s->>'pos')::int,
        (s->>'key') = 'scheduled'
      );
    END LOOP;

    UPDATE public.posts p
      SET pipeline_id = v_pipeline_id,
          stage_id = st.id,
          position = 1024 * (
            SELECT COUNT(*) FROM public.posts p2
            WHERE p2.client_id = p.client_id AND p2.stage = p.stage AND p2.created_at <= p.created_at
          )
      FROM public.content_pipeline_stages st
      WHERE p.client_id = r_client.client_id
        AND st.pipeline_id = v_pipeline_id
        AND st.key = p.stage::text;
  END LOOP;
END $$;

-- 6. Estender log de post para lidar com stage_id
CREATE OR REPLACE FUNCTION public.log_post_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.activity_events (brand_id, client_id, actor_id, entity_type, entity_id, verb, payload)
    VALUES (NEW.brand_id, NEW.client_id, NEW.created_by, 'post', NEW.id, 'created',
            jsonb_build_object('title', NEW.title));
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.stage_id IS DISTINCT FROM NEW.stage_id OR OLD.stage <> NEW.stage THEN
      INSERT INTO public.activity_events (brand_id, client_id, actor_id, entity_type, entity_id, verb, payload)
      VALUES (NEW.brand_id, NEW.client_id, auth.uid(), 'post', NEW.id, 'stage_changed',
              jsonb_build_object(
                'from', OLD.stage, 'to', NEW.stage,
                'from_stage_id', OLD.stage_id, 'to_stage_id', NEW.stage_id,
                'title', NEW.title
              ));
    END IF;
    IF OLD.pipeline_id IS DISTINCT FROM NEW.pipeline_id THEN
      INSERT INTO public.activity_events (brand_id, client_id, actor_id, entity_type, entity_id, verb, payload)
      VALUES (NEW.brand_id, NEW.client_id, auth.uid(), 'post', NEW.id, 'pipeline_changed',
              jsonb_build_object(
                'from_pipeline_id', OLD.pipeline_id,
                'to_pipeline_id', NEW.pipeline_id,
                'title', NEW.title
              ));
    END IF;
  END IF;
  RETURN NEW;
END $$;
