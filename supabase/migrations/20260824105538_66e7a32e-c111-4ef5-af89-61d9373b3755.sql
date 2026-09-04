-- 1) brain_worker_runs: métricas internas apenas para super admins
DROP POLICY IF EXISTS brain_worker_runs_read ON public.brain_worker_runs;
CREATE POLICY brain_worker_runs_read
  ON public.brain_worker_runs
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- 2) notifications: INSERT apenas para si mesmo (server-side usa service_role)
DROP POLICY IF EXISTS "brand members create notifications" ON public.notifications;
CREATE POLICY "users create own notifications"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_brand_member(brand_id, auth.uid())
  );

-- 3) Funções de gatilho: não devem ser executáveis por nenhum role de API
REVOKE EXECUTE ON FUNCTION public.clients_set_default_owner() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enable_default_brand_features() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_task_project_client() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_super_admin_flag() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.posts_sync_legacy_stage() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_social_posts_sync_publication() FROM PUBLIC, anon, authenticated;

-- 4) Helpers internos: remover acesso anônimo (mantém authenticated onde é usado por RLS/app)
REVOKE EXECUTE ON FUNCTION public._portal_session_any(text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._portal_session_user(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_access_client_row(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_invite_brand_role(uuid, uuid, app_role, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_agency_operator(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notification_prefs_allows(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reactivate_portal_token(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.stop_timer(uuid, text) FROM PUBLIC, anon;
