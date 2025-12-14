import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface NewsItem {
  id: string;
  link: string;
  title: string | null;
  response_text: string | null;
  processed_at: string;
  created_at: string;
  published_at: string | null;
}

export function useNewsItems() {
  return useQuery({
    queryKey: ["news-items"],
    queryFn: async () => {
      // Get timestamp for 12 hours ago
      const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
      
      const { data, error } = await supabase
        .from("news_items")
        .select("*")
        .or(`published_at.gte.${twelveHoursAgo},published_at.is.null`)
        .not("response_text", "like", "Webhook error:%")
        .order("published_at", { ascending: false, nullsFirst: false });

      if (error) throw error;
      return data as NewsItem[];
    },
    refetchInterval: 60000, // Refetch every minute
  });
}
