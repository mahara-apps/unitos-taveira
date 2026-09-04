ALTER TABLE public.installations
  ADD COLUMN IF NOT EXISTS health_checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS health_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS active_operation_id uuid;

ALTER TABLE public.installation_operations
  ADD COLUMN IF NOT EXISTS steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS error_kind text,
  ADD COLUMN IF NOT EXISTS run_token_hash text,
  ADD COLUMN IF NOT EXISTS run_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_report_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS installation_operations_one_active
  ON public.installation_operations (installation_id)
  WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS installation_operations_run_token_hash_idx
  ON public.installation_operations (run_token_hash)
  WHERE run_token_hash IS NOT NULL;