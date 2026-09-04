
-- =========================================================
-- 1) Hardening: revogar EXECUTE de funções administrativas
--    e de gatilho para PUBLIC/anon/authenticated.
--    Mantém funções portal_* acessíveis a anon (necessárias).
-- =========================================================

-- Funções administrativas (não devem ser chamáveis por anon/authenticated diretamente)
REVOKE EXECUTE ON FUNCTION public.has_brand_role(uuid, uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_brand_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.accept_brand_invite(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reap_stuck_ai_jobs() FROM PUBLIC, anon, authenticated;

-- Funções de trigger (nunca devem ser executáveis por roles do cliente)
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.add_brand_owner() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_post_activity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_task_activity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_pipeline_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_task_mentions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_task_assigned() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_post_approval_events() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_ai_job_completed() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_deadline_notifications() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_media_plan_item_amount() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_media_plan_items_on_plan() FROM PUBLIC, anon, authenticated;

-- =========================================================
-- 2) Índices de performance
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_activity_events_brand_created
  ON public.activity_events (brand_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_events_brand_client_created
  ON public.activity_events (brand_id, client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_user_created
  ON public.ai_jobs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_brand_members_user
  ON public.brand_members (user_id);
