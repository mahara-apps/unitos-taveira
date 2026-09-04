
DROP POLICY IF EXISTS "portal_anon_read_brand_assets" ON storage.objects;

CREATE POLICY "portal_anon_read_brand_assets"
ON storage.objects
FOR SELECT
TO anon
USING (
  bucket_id = ANY (ARRAY['brand-assets'::text, 'brand-documents'::text])
  AND EXISTS (
    SELECT 1
    FROM public.portal_tokens pt
    JOIN public.clients c ON c.id = pt.client_id
    WHERE pt.revoked_at IS NULL
      AND (pt.expires_at IS NULL OR pt.expires_at > now())
      AND (storage.foldername(storage.objects.name))[1] = c.brand_id::text
      AND (storage.foldername(storage.objects.name))[2] = pt.client_id::text
  )
);

CREATE INDEX IF NOT EXISTS idx_activity_events_brand_created
  ON public.activity_events (brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_events_brand_client_created
  ON public.activity_events (brand_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_user_created
  ON public.ai_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_brand_client_stage
  ON public.posts (brand_id, client_id, stage);
CREATE INDEX IF NOT EXISTS idx_tasks_brand_client_done
  ON public.tasks (brand_id, client_id, done);

REVOKE EXECUTE ON FUNCTION public.log_post_activity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_task_activity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_task_assigned() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_task_mentions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.add_brand_owner() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_pipeline_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._portal_session(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reap_stuck_ai_jobs() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.has_brand_role(uuid, uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_brand_member(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.accept_brand_invite(text) FROM anon;
