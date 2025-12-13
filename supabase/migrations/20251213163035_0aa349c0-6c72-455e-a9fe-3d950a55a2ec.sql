-- Allow public delete (for cleanup)
CREATE POLICY "Anyone can delete news items" 
ON public.news_items 
FOR DELETE 
USING (true);