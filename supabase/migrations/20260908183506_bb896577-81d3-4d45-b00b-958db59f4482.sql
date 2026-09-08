CREATE OR REPLACE FUNCTION public.guard_content_trash_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand_id uuid := coalesce(NEW.brand_id, OLD.brand_id);
  v_role text;
BEGIN
  IF OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at
     AND OLD.deleted_by IS NOT DISTINCT FROM NEW.deleted_by THEN
    RETURN NEW;
  END IF;

  v_role := public.app_access_role(auth.uid(), v_brand_id);
  IF v_role NOT IN ('super_admin', 'admin') THEN
    RAISE EXCEPTION 'content_trash_admin_required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_posts_trash_changes ON public.posts;
CREATE TRIGGER guard_posts_trash_changes
BEFORE UPDATE OF deleted_at, deleted_by ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.guard_content_trash_changes();

DROP TRIGGER IF EXISTS guard_content_pipelines_trash_changes ON public.content_pipelines;
CREATE TRIGGER guard_content_pipelines_trash_changes
BEFORE UPDATE OF deleted_at, deleted_by ON public.content_pipelines
FOR EACH ROW EXECUTE FUNCTION public.guard_content_trash_changes();

CREATE OR REPLACE FUNCTION public.purge_deleted_content()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - interval '30 days';
  v_posts integer := 0;
  v_pipelines integer := 0;
BEGIN
  WITH removed AS (
    DELETE FROM public.posts
    WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff
    RETURNING id
  )
  SELECT count(*)::integer INTO v_posts FROM removed;

  WITH removed AS (
    DELETE FROM public.content_pipelines p
    WHERE p.deleted_at IS NOT NULL
      AND p.deleted_at < v_cutoff
      AND NOT EXISTS (SELECT 1 FROM public.posts po WHERE po.pipeline_id = p.id)
    RETURNING id
  )
  SELECT count(*)::integer INTO v_pipelines FROM removed;

  RETURN jsonb_build_object(
    'posts_purged', v_posts,
    'pipelines_purged', v_pipelines,
    'cutoff', v_cutoff
  );
END;
$$;

REVOKE ALL ON FUNCTION public.guard_content_trash_changes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_content_trash_changes() TO service_role;
REVOKE ALL ON FUNCTION public.purge_deleted_content() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_deleted_content() TO service_role;