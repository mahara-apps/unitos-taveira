ALTER TABLE public.installation_credentials
  ADD COLUMN IF NOT EXISTS generated_secrets_ciphertext text;

COMMENT ON COLUMN public.installation_credentials.generated_secrets_ciphertext IS
  'JSON cifrado (AES-256-GCM) com os secrets exclusivos da instalação (CRON_SECRET, BRAND_CREDENTIALS_SECRET, META_STATE_SECRET, META_WEBHOOK_VERIFY_TOKEN). Gerados uma única vez e reutilizados: regerar invalida tokens já cifrados no destino.';