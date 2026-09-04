ALTER TABLE public.installations
  ADD COLUMN IF NOT EXISTS pinned_commit_sha text,
  ADD COLUMN IF NOT EXISTS pinned_release text,
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS pinned_by uuid;