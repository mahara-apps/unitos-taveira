CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-models-health-daily') THEN
    PERFORM cron.unschedule('ai-models-health-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'ai-models-health-daily',
  '20 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--3f33732a-cb8b-43ae-84fb-01d9e367fb0c.lovable.app/api/public/hooks/ai-models-health',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRramJodHR5bG91YW1xeG5iZmd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNTcyMDcsImV4cCI6MjA5ODczMzIwN30.bRyK6jhVUXU7dAC1BGQbd4bllBm-UgatOOQdkfk1EFA'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);