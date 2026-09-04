-- lovable-cron-fallback-reviewed: 1440 runs/day; continuação do provisionamento de instalações em fatias curtas — sem backstop por minuto o processo só avança com a aba aberta e uma cadência maior faria cada instalação levar horas
do $$
begin
  if exists (select 1 from cron.job where jobname = 'installation-provision-resume') then
    perform cron.unschedule('installation-provision-resume');
  end if;
  perform cron.schedule(
    'installation-provision-resume',
    '* * * * *',
    $fmt$select net.http_post(
        url := 'https://project--3f33732a-cb8b-43ae-84fb-01d9e367fb0c.lovable.app/api/public/cron/installation-resume',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', public.cron_secret()),
        body := '{}'::jsonb
      );$fmt$
  );
end $$;