do $$
declare
  base text := 'https://project--3f33732a-cb8b-43ae-84fb-01d9e367fb0c.lovable.app';
  j record;
  paths jsonb := jsonb_build_object(
    'prune-post-media-30d', '/api/public/media/prune',
    'brain-consolidate-daily', '/api/public/hooks/brain-consolidate',
    'sla-overdue-check-hourly', '/api/public/cron/sla-check',
    'meta-publish-scheduled', '/api/public/meta/publish-scheduled',
    'brain-synthesis-nightly', '/api/public/hooks/brain-synthesis',
    'brain-social-metrics-sync', '/api/public/hooks/social-metrics-sync',
    'ai-models-health-daily', '/api/public/hooks/ai-models-health'
  );
  k text;
begin
  for k in select jsonb_object_keys(paths) loop
    select * into j from cron.job where jobname = k;
    if j.jobid is null then
      continue;
    end if;
    perform cron.schedule(
      k,
      j.schedule,
      format(
        $cmd$select net.http_post(
          url := %L,
          headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.cron_secret()),
          body := '{}'::jsonb
        );$cmd$,
        base || (paths ->> k)
      )
    );
  end loop;
end $$;
