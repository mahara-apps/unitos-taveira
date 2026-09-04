
ALTER TABLE public.content_pipelines
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS icon text;

ALTER TABLE public.content_pipeline_stages
  ADD COLUMN IF NOT EXISTS hide_in_portal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enables_approval_link boolean NOT NULL DEFAULT false;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS format text,
  ADD COLUMN IF NOT EXISTS channels text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS visible_in_portal boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS internal_briefing text,
  ADD COLUMN IF NOT EXISTS client_briefing text,
  ADD COLUMN IF NOT EXISTS script jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "references" jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS posts_priority_idx ON public.posts(priority);
CREATE INDEX IF NOT EXISTS posts_tags_gin ON public.posts USING gin(tags);
CREATE INDEX IF NOT EXISTS posts_channels_gin ON public.posts USING gin(channels);

CREATE TABLE IF NOT EXISTS public.card_approval_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS card_approval_tokens_post_idx ON public.card_approval_tokens(post_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_approval_tokens TO authenticated;
GRANT ALL ON public.card_approval_tokens TO service_role;
ALTER TABLE public.card_approval_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brand members manage approval tokens" ON public.card_approval_tokens;
CREATE POLICY "brand members manage approval tokens"
  ON public.card_approval_tokens FOR ALL
  TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()))
  WITH CHECK (public.is_brand_member(brand_id, auth.uid()));

CREATE TABLE IF NOT EXISTS public.card_approval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  token_id uuid REFERENCES public.card_approval_tokens(id) ON DELETE SET NULL,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  verb text NOT NULL,
  comment text,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS card_approval_events_post_idx ON public.card_approval_events(post_id, created_at DESC);

GRANT SELECT ON public.card_approval_events TO authenticated;
GRANT ALL ON public.card_approval_events TO service_role;
ALTER TABLE public.card_approval_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brand members read approval events" ON public.card_approval_events;
CREATE POLICY "brand members read approval events"
  ON public.card_approval_events FOR SELECT
  TO authenticated
  USING (public.is_brand_member(brand_id, auth.uid()));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'card_approval_events'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.card_approval_events';
  END IF;
END $$;

INSERT INTO public.agent_prompts (agent_id, agent_name, system_prompt, required_fields)
VALUES (
  'roteirista_social',
  'Roteirista Social',
  'Você é roteirista sênior de conteúdo social. Escreva roteiros em cenas numeradas com: cena, tempo (segundos), narrador/personagem, fala e observação de direção visual. Formato JSON: [{"cena":1,"tempo":"0-3s","narrador":"...","fala":"...","observacao":"..."}]. Use o Brand Blueprint fornecido para tom de voz, persona e proposta de valor. Máximo 8 cenas para Reels/Shorts; até 15 para vídeos longos. Responda APENAS com JSON válido.',
  '["brand_blueprint","objetivo"]'::jsonb
)
ON CONFLICT (agent_id) DO UPDATE SET
  agent_name = EXCLUDED.agent_name,
  system_prompt = EXCLUDED.system_prompt,
  required_fields = EXCLUDED.required_fields,
  updated_at = now();
