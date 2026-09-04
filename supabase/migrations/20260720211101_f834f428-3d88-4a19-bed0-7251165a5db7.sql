CREATE OR REPLACE FUNCTION public.notify_post_approval_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target uuid;
BEGIN
  -- Approval requested: post moves into 'review' stage
  IF TG_OP = 'UPDATE'
     AND NEW.stage = 'review'::public.post_stage
     AND OLD.stage IS DISTINCT FROM NEW.stage THEN
    INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload)
    SELECT m.user_id, NEW.brand_id, 'approval_requested',
           'Post aguardando aprovação',
           NEW.title,
           '/customers/' || COALESCE(NEW.client_id::text, '') || '?post=' || NEW.id::text,
           jsonb_build_object('source','post','post_id', NEW.id)
      FROM public.brand_members m
     WHERE m.brand_id = NEW.brand_id
       AND m.user_id <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid);
  END IF;

  -- Approval decision: approved stage transition
  IF TG_OP = 'UPDATE'
     AND OLD.stage IS DISTINCT FROM NEW.stage
     AND NEW.stage = 'approved'::public.post_stage THEN
    target := COALESCE(NEW.assignee_id, NEW.created_by);
    IF target IS NOT NULL AND target <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) THEN
      INSERT INTO public.notifications(user_id, brand_id, kind, title, body, href, payload)
      VALUES (
        target, NEW.brand_id, 'approval_decision',
        'Post aprovado',
        NEW.title,
        '/customers/' || COALESCE(NEW.client_id::text, '') || '?post=' || NEW.id::text,
        jsonb_build_object('source','post','post_id', NEW.id, 'stage', NEW.stage)
      );
    END IF;
  END IF;

  RETURN NEW;
END $$;