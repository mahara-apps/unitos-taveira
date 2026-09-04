
-- Schedule 30-day media pruning: keeps thumbnails, removes originals
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop previous schedule if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-post-media-30d') THEN
    PERFORM cron.unschedule('prune-post-media-30d');
  END IF;
END $$;

SELECT cron.schedule(
  'prune-post-media-30d',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--3dfcbab1-0116-4c76-9aab-8a9d2e458514.lovable.app/api/public/media/prune',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRramJodHR5bG91YW1xeG5iZmd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNTcyMDcsImV4cCI6MjA5ODczMzIwN30.bRyK6jhVUXU7dAC1BGQbd4bllBm-UgatOOQdkfk1EFA'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
