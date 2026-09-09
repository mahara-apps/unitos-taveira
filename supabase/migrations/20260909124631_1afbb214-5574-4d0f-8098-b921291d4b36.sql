-- lovable-cron-fallback-reviewed: 288 runs/day; wake-on-enqueue trigger is the primary path; this drain job is created only while pending copy rows exist and unschedules itself after drain, so idle days run 0 times
CREATE TABLE IF NOT EXISTS public.post_copy_queue_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_notified_at timestamptz,
  drain_scheduled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.post_copy_queue_state TO service_role;
GRANT SELECT ON public.post_copy_queue_state TO authenticated;

ALTER TABLE public.post_copy_queue_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admin vê o estado da fila de legendas" ON public.post_copy_queue_state;
CREATE POLICY "Super admin vê o estado da fila de legendas"
  ON public.post_copy_queue_state FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

INSERT INTO public.post_copy_queue_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_post_copy_queue_state_updated_at ON public.post_copy_queue_state;
CREATE TRIGGER trg_post_copy_queue_state_updated_at
  BEFORE UPDATE ON public.post_copy_queue_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.post_copy_queue_drain_on()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'post-content-drain') THEN
    UPDATE public.post_copy_queue_state SET drain_scheduled = true WHERE id;
    RETURN true;
  END IF;

  SELECT rtrim(app_url, '/') INTO v_url FROM public.installation LIMIT 1;
  IF v_url IS NULL OR public.cron_secret() IS NULL THEN
    RETURN false;
  END IF;

  PERFORM cron.schedule(
    'post-content-drain',
    '*/5 * * * *',
    format($fmt$select net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.cron_secret()),
        body := '{}'::jsonb
      );$fmt$, v_url || '/api/public/hooks/resume-post-content')
  );
  UPDATE public.post_copy_queue_state SET drain_scheduled = true WHERE id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_copy_queue_drain_off()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'post-content-drain') THEN
    PERFORM cron.unschedule('post-content-drain');
  END IF;
  UPDATE public.post_copy_queue_state SET drain_scheduled = false WHERE id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_copy_queue_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_fresh boolean;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF coalesce(NEW.copy, '') <> '' THEN RETURN NEW; END IF;
  IF coalesce(NEW.ai_phase, 'idea') NOT IN ('idea', 'copy_failed', 'copy_failed_retryable') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND coalesce(OLD.ai_phase, 'idea') = coalesce(NEW.ai_phase, 'idea')
     AND coalesce(OLD.copy, '') = coalesce(NEW.copy, '') THEN
    RETURN NEW;
  END IF;

  UPDATE public.post_copy_queue_state
     SET last_notified_at = now()
   WHERE id
     AND (last_notified_at IS NULL OR last_notified_at < now() - interval '20 seconds')
  RETURNING true INTO v_fresh;

  PERFORM public.post_copy_queue_drain_on();

  IF NOT coalesce(v_fresh, false) THEN RETURN NEW; END IF;

  SELECT rtrim(app_url, '/') INTO v_url FROM public.installation LIMIT 1;
  IF v_url IS NULL OR public.cron_secret() IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url := v_url || '/api/public/hooks/resume-post-content',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', public.cron_secret()
    ),
    body := '{}'::jsonb
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_copy_queue_notify ON public.posts;
CREATE TRIGGER trg_post_copy_queue_notify
  AFTER INSERT OR UPDATE OF ai_phase, copy ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.post_copy_queue_notify();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'post-content-resume') THEN
    PERFORM cron.unschedule('post-content-resume');
  END IF;
END;
$$;