ALTER TABLE public.installations
  ADD COLUMN IF NOT EXISTS requires_own_supabase_token boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.installations.requires_own_supabase_token IS
  'BYOK: quando true, o provisionamento exige o Supabase Access Token proprio da instalacao e nao usa o token global do MASTER.';