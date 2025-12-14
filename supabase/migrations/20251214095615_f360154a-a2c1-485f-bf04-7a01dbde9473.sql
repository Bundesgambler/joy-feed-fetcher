-- Enable pg_cron extension for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Grant usage to postgres role
GRANT USAGE ON SCHEMA cron TO postgres;

-- Create a cron job that runs every hour to delete articles older than 24 hours
SELECT cron.schedule(
  'cleanup-old-news-items',
  '0 * * * *', -- Run every hour at minute 0
  $$DELETE FROM public.news_items WHERE processed_at < NOW() - INTERVAL '24 hours'$$
);