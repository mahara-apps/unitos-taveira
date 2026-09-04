
-- 1) Fix mutable search_path on is_super_admin() no-arg
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(auth.jwt()->>'email') IN (
    'apitadadigital@gmail.com',
    'jose@mahara.marketing'
  );
$$;

-- 2) Revoke anon EXECUTE on SECURITY DEFINER functions that must not be public.
--    Portal_* functions remain callable by anon (public portal by design).
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.notify_task_assigned() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.notify_task_mentions() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.protect_pipeline_delete() FROM anon, public;

-- 3) Lock down agent_prompts to super-admins only (both read and write).
DROP POLICY IF EXISTS agent_prompts_read_authenticated ON public.agent_prompts;
DROP POLICY IF EXISTS agent_prompts_update_managers ON public.agent_prompts;

CREATE POLICY agent_prompts_read_super_admin
  ON public.agent_prompts
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY agent_prompts_update_super_admin
  ON public.agent_prompts
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));
