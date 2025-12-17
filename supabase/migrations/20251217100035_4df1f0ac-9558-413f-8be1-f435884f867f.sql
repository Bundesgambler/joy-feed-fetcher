-- Track scheduled/manual RSS runs so the UI can display the last successful run time
CREATE TABLE IF NOT EXISTS public.rss_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ NULL,
  trigger TEXT NOT NULL DEFAULT 'cron',
  success BOOLEAN NOT NULL DEFAULT true,
  processed INTEGER NOT NULL DEFAULT 0,
  message TEXT NULL,
  error TEXT NULL
);

CREATE INDEX IF NOT EXISTS rss_runs_started_at_desc_idx
  ON public.rss_runs (started_at DESC);

ALTER TABLE public.rss_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rss_runs'
      AND policyname = 'Anyone can view rss runs'
  ) THEN
    CREATE POLICY "Anyone can view rss runs"
    ON public.rss_runs
    FOR SELECT
    USING (true);
  END IF;
END $$;