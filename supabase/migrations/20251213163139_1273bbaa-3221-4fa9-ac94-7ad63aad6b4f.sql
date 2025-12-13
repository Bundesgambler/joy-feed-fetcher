-- Add published_at column to store article's original publication date
ALTER TABLE public.news_items 
ADD COLUMN published_at TIMESTAMP WITH TIME ZONE;