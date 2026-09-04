ALTER TABLE public.monthly_plans DROP CONSTRAINT IF EXISTS monthly_plans_status_check;

ALTER TABLE public.monthly_plans
  ADD CONSTRAINT monthly_plans_status_check
  CHECK (status = ANY (ARRAY[
    'draft'::text,
    'pending_client'::text,
    'client_approved'::text,
    'changes_requested'::text,
    'client_rejected'::text,
    'approved'::text,
    'archived'::text
  ]));