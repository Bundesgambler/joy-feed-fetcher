import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RSS_URL = 'https://nius.de/rss'
const WEBHOOK_URL = 'https://n8n.mariohau.de/webhook/0d0e30a1-bd1a-4f86-b3af-25040c575a7e'

interface RSSItem {
  title: string;
  link: string;
  pubDate: string | null;
}

function parseRSS(xmlText: string): RSSItem[] {
  const items: RSSItem[] = [];
  
  // Simple regex-based XML parsing for RSS items
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const titleRegex = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/;
  const linkRegex = /<link><!\[CDATA\[([\s\S]*?)\]\]><\/link>|<link>([\s\S]*?)<\/link>/;
  const pubDateRegex = /<pubDate><!\[CDATA\[([\s\S]*?)\]\]><\/pubDate>|<pubDate>([\s\S]*?)<\/pubDate>/;
  
  let match;
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemContent = match[1];
    
    const titleMatch = titleRegex.exec(itemContent);
    const linkMatch = linkRegex.exec(itemContent);
    const pubDateMatch = pubDateRegex.exec(itemContent);
    
    if (linkMatch) {
      const title = titleMatch ? (titleMatch[1] || titleMatch[2] || '').trim() : '';
      const link = (linkMatch[1] || linkMatch[2] || '').trim();
      const pubDate = pubDateMatch ? (pubDateMatch[1] || pubDateMatch[2] || '').trim() : null;
      
      if (link) {
        items.push({ title, link, pubDate });
      }
    }
  }
  
  return items;
}

function isArticleWithin12Hours(pubDate: string | null): boolean {
  if (!pubDate) return true; // If no date, include it
  
  try {
    const articleDate = new Date(pubDate);
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    return articleDate >= twelveHoursAgo;
  } catch {
    return true; // If parsing fails, include it
  }
}

function isWithinOperatingHours(): boolean {
  const now = new Date();
  // Convert to German timezone (CET/CEST)
  const germanTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  const hour = germanTime.getHours();
  
  console.log(`Current German time: ${germanTime.toLocaleString('de-DE')}, Hour: ${hour}`);
  
  return hour >= 7 && hour < 20;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Check if we're within operating hours (7:00 - 20:00 German time)
    if (!isWithinOperatingHours()) {
      console.log('Outside operating hours (7:00-20:00). Skipping.');
      return new Response(
        JSON.stringify({ success: true, message: 'Outside operating hours (7:00-20:00)', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Fetching RSS feed from:', RSS_URL);
    
    // Fetch RSS feed
    const rssResponse = await fetch(RSS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSSReader/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      }
    });
    
    if (!rssResponse.ok) {
      throw new Error(`Failed to fetch RSS: ${rssResponse.status} ${rssResponse.statusText}`);
    }
    
    const rssText = await rssResponse.text();
    console.log('RSS feed fetched, length:', rssText.length);
    
    // Parse RSS items
    const rssItems = parseRSS(rssText);
    console.log('Parsed RSS items:', rssItems.length);
    
    if (rssItems.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No items found in RSS feed', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Get existing links from database
    const { data: existingItems, error: fetchError } = await supabase
      .from('news_items')
      .select('link');
    
    if (fetchError) {
      console.error('Error fetching existing items:', fetchError);
      throw fetchError;
    }
    
    const existingLinks = new Set(existingItems?.map(item => item.link) || []);
    console.log('Existing items in database:', existingLinks.size);
    
    // Filter new items that are within 12 hours
    const newItems = rssItems.filter(item => 
      !existingLinks.has(item.link) && isArticleWithin12Hours(item.pubDate)
    );
    console.log('New items to process (within 12 hours):', newItems.length);
    
    let processedCount = 0;
    
    // Process each new item
    for (const item of newItems) {
      try {
        console.log('Processing item:', item.link);
        
        // Send link to webhook
        console.log('Calling webhook:', WEBHOOK_URL);
        const webhookResponse = await fetch(WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
          },
          body: JSON.stringify({
            link: item.link,
            title: item.title,
            timestamp: new Date().toISOString()
          })
        });
        
        console.log('Webhook response status:', webhookResponse.status);
        
        let responseText = '';
        
        if (webhookResponse.ok) {
          responseText = await webhookResponse.text();
          console.log('Webhook response for', item.link, ':', responseText.substring(0, 100));
        } else {
          const errorBody = await webhookResponse.text();
          console.error('Webhook error:', webhookResponse.status, errorBody);
          responseText = `Webhook error: ${webhookResponse.status}`;
        }
        
        // Store in database with published_at from RSS
        const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : null;
        
        const { error: insertError } = await supabase
          .from('news_items')
          .insert({
            link: item.link,
            title: item.title,
            response_text: responseText,
            processed_at: new Date().toISOString(),
            published_at: publishedAt
          });
        
        if (insertError) {
          console.error('Error inserting item:', insertError);
          // Continue with next item even if insert fails
        } else {
          processedCount++;
        }
        
      } catch (itemError) {
        console.error('Error processing item:', item.link, itemError);
      }
    }
    
    console.log('Processing complete. Processed:', processedCount);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Processed ${processedCount} new items`,
        processed: processedCount,
        total_in_feed: rssItems.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error in check-rss function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
