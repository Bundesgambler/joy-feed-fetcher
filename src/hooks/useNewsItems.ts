import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface NewsItem {
  id: string;
  link: string;
  title: string | null;
  response_text: string | null;
  processed_at: string;
  created_at: string;
}

export function useNewsItems() {
  return useQuery({
    queryKey: ["news-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("news_items")
        .select("*")
        .order("processed_at", { ascending: false });

      if (error) throw error;
      return data as NewsItem[];
    },
    refetchInterval: 60000, // Refetch every minute
  });
}
