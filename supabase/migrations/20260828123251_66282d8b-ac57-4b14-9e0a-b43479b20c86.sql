ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS inactivated_at timestamptz;

CREATE INDEX IF NOT EXISTS brands_is_active_idx ON public.brands (is_active);