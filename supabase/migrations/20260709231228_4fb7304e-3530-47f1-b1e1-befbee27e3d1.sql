ALTER TABLE public.brand_pautas
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'backlog',
  ADD COLUMN IF NOT EXISTS pilar_type text,
  ADD COLUMN IF NOT EXISTS formato text;

-- Backfill formato from legacy formato_recomendado
UPDATE public.brand_pautas SET formato = formato_recomendado WHERE formato IS NULL AND formato_recomendado IS NOT NULL;
UPDATE public.brand_pautas SET pilar_type = pilar WHERE pilar_type IS NULL AND pilar IS NOT NULL;