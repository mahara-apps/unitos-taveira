ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS clients_owner_user_id_idx ON public.clients(owner_user_id);
CREATE INDEX IF NOT EXISTS clients_is_active_idx ON public.clients(is_active);