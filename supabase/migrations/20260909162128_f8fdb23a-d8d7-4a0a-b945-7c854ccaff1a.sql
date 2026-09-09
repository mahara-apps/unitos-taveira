ALTER TABLE public.installation
  ADD COLUMN IF NOT EXISTS service_state text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS service_message text,
  ADD COLUMN IF NOT EXISTS service_until timestamptz,
  ADD COLUMN IF NOT EXISTS service_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS service_changed_by text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'installation_service_state_check'
      AND conrelid = 'public.installation'::regclass
  ) THEN
    ALTER TABLE public.installation
      ADD CONSTRAINT installation_service_state_check
      CHECK (service_state IN ('active', 'maintenance', 'suspended'));
  END IF;
END $$;

COMMENT ON COLUMN public.installation.service_state IS 'active | maintenance (atualizacao em andamento) | suspended (acesso bloqueado)';