-- Drop the overly permissive INSERT and DELETE policies
DROP POLICY IF EXISTS "Anyone can insert news items" ON public.news_items;
DROP POLICY IF EXISTS "Anyone can delete news items" ON public.news_items;

-- Create restrictive policies - only service role can insert/delete (via edge functions)
-- The SELECT policy remains so the frontend can read items
CREATE POLICY "Service role can insert news items"
ON public.news_items
FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "Service role can delete news items"
ON public.news_items
FOR DELETE
TO service_role
USING (true);

CREATE POLICY "Service role can update news items"
ON public.news_items
FOR UPDATE
TO service_role
USING (true);