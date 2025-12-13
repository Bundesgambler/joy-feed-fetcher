-- Create table for storing processed news items
CREATE TABLE public.news_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  link TEXT NOT NULL UNIQUE,
  title TEXT,
  response_text TEXT,
  processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.news_items ENABLE ROW LEVEL SECURITY;

-- Allow public read access (no auth required for this tool)
CREATE POLICY "Anyone can view news items" 
ON public.news_items 
FOR SELECT 
USING (true);

-- Allow public insert (from edge function)
CREATE POLICY "Anyone can insert news items" 
ON public.news_items 
FOR INSERT 
WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX idx_news_items_link ON public.news_items(link);
CREATE INDEX idx_news_items_processed_at ON public.news_items(processed_at DESC);