-- Soft-delete + rework support for posts
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS rework_notes text NULL;

CREATE INDEX IF NOT EXISTS posts_deleted_at_idx ON public.posts (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS posts_scheduled_at_idx ON public.posts (scheduled_at) WHERE deleted_at IS NULL AND scheduled_at IS NOT NULL;