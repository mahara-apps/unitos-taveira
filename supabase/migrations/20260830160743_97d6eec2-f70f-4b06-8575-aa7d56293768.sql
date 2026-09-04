ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS overage_policy text NOT NULL DEFAULT 'block';

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS overage_policy text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'brands_overage_policy_check'
  ) THEN
    ALTER TABLE public.brands
      ADD CONSTRAINT brands_overage_policy_check
      CHECK (overage_policy IN ('block','warn'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_overage_policy_check'
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_overage_policy_check
      CHECK (overage_policy IS NULL OR overage_policy IN ('block','warn'));
  END IF;
END $$;