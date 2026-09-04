
CREATE TABLE public.meta_oauth_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  meta_user_id TEXT NOT NULL,
  meta_user_name TEXT,
  meta_user_email TEXT,
  user_token_ciphertext TEXT NOT NULL,
  user_token_expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  pages JSONB NOT NULL DEFAULT '[]'::jsonb,
  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, DELETE ON public.meta_oauth_sessions TO authenticated;
GRANT ALL ON public.meta_oauth_sessions TO service_role;

ALTER TABLE public.meta_oauth_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own meta sessions"
  ON public.meta_oauth_sessions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own meta sessions"
  ON public.meta_oauth_sessions FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX idx_meta_oauth_sessions_user ON public.meta_oauth_sessions(user_id, created_at DESC);
CREATE INDEX idx_meta_oauth_sessions_expires ON public.meta_oauth_sessions(expires_at);

-- Fast lookup by webhook payload (page_id or ig_business_id).
CREATE INDEX IF NOT EXISTS idx_social_connections_channel_external
  ON public.social_connections(channel, external_id);
