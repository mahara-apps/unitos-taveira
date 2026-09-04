ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS ai_phase_at timestamptz;
UPDATE public.posts SET ai_phase_at = updated_at WHERE ai_phase_at IS NULL AND ai_phase IS NOT NULL;