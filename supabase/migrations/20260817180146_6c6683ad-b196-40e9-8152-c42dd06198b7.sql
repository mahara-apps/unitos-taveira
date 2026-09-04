UPDATE public.social_posts
   SET status = 'scheduled', scheduled_at = now(), publish_locked_at = NULL, last_error = NULL
 WHERE id = 'eef12874-8fcd-40ab-8c8f-cc181178aee4';