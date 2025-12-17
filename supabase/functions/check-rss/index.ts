import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RSS_SOURCES = {
  nius: {
    name: 'NIUS',
    url: 'https://nius.de/rss'
  },
  jungefreiheit: {
    name: 'Junge Freiheit',
    url: 'https://jungefreiheit.de/feed/'
  },
  apollonews: {
    name: 'Apollo News',
    url: 'https://apollo-news.net/feed/'
  },
  freilichmagazin: {
    name: 'Freilich Magazin',
    url: 'https://freilich-magazin.com/rss.xml'
  }
} as const;

type SourceKey = keyof typeof RSS_SOURCES;

// Read webhook URLs from environment secrets
const getWebhookUrl = (mode: string): string => {
  if (mode === 'test') {
    return Deno.env.get('WEBHOOK_URL_TEST') || '';
  }
  return Deno.env.get('WEBHOOK_URL_PRODUCTION') || '';
};

const getTeamsWebhookUrl = (mode: string): string => {
  if (mode === 'test') {
    return Deno.env.get('TEAMS_WEBHOOK_TEST') || '';
  }
  return Deno.env.get('TEAMS_WEBHOOK_PRODUCTION') || '';
};

interface RSSItem {
  title: string;
  link: string;
  pubDate: string | null;
}

// Verify JWT token
async function verifyToken(token: string, secret: string): Promise<{ valid: boolean; payload?: any }> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false };
    }
    
    const [headerB64, payloadB64, signatureB64] = parts;
    const encoder = new TextEncoder();
    const data = `${headerB64}.${payloadB64}`;
    
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    // Decode signature from base64url
    const signatureStr = signatureB64.replace(/-/g, '+').replace(/_/g, '/');
    const signature = Uint8Array.from(atob(signatureStr), c => c.charCodeAt(0));
    
    const isValid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(data));
    
    if (!isValid) {
      return { valid: false };
    }
    
    // Decode payload
    const payload = JSON.parse(atob(payloadB64));
    
    // Check expiration
    if (payload.exp && payload.exp < Date.now()) {
      return { valid: false };
    }
    
    return { valid: true, payload };
  } catch (error) {
    console.error('Token verification error:', error);
    return { valid: false };
  }
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
    // Authenticate the request
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      console.log('No authorization header provided');
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const jwtSecret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!jwtSecret) {
      console.error('SUPABASE_SERVICE_ROLE_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authResult = await verifyToken(token, jwtSecret);
    if (!authResult.valid) {
      console.log('Invalid or expired token');
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Authentication successful');

    // Parse request body to get webhook mode and sources
    let webhookMode = 'production';
    let enabledSources: SourceKey[] = ['nius', 'jungefreiheit', 'apollonews', 'freilichmagazin']; // Default: all enabled
    let retryItem: { id: string; link: string; title: string | null } | null = null;
    let teamsEnabled = false;
    let teamsMode = 'production';
    
    try {
      const body = await req.json();
      if (body.webhookMode === 'test') {
        webhookMode = 'test';
      }
      if (Array.isArray(body.sources) && body.sources.length > 0) {
        enabledSources = body.sources.filter((s: string) => s in RSS_SOURCES) as SourceKey[];
      }
      if (body.retryItem) {
        retryItem = body.retryItem;
      }
      if (body.teamsEnabled === true) {
        teamsEnabled = true;
      }
      if (body.teamsMode === 'test') {
        teamsMode = 'test';
      }
    } catch {
      // No body or invalid JSON, use defaults
    }
    
    const WEBHOOK_URL = getWebhookUrl(webhookMode);
    const TEAMS_WEBHOOK_URL = getTeamsWebhookUrl(teamsMode);
    
    if (!WEBHOOK_URL) {
      console.error('Webhook URL not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'Webhook URL not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Using ${webhookMode} webhook`);
    console.log(`Teams enabled: ${teamsEnabled}, mode: ${teamsMode}`);
    
    // Handle retry for a single item
    if (retryItem) {
      console.log('Retrying webhook for item:', retryItem.link);
      
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      try {
        const webhookResponse = await fetch(WEBHOOK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
          },
          body: JSON.stringify({
            link: retryItem.link,
            title: retryItem.title,
            source: 'Retry',
            timestamp: new Date().toISOString()
          })
        });
        
        let responseText = '';
        
        if (webhookResponse.ok) {
          const rawResponse = await webhookResponse.text();
          console.log('Retry webhook raw response:', rawResponse.substring(0, 100));
          
          try {
            const jsonResponse = JSON.parse(rawResponse);
            if (Array.isArray(jsonResponse) && jsonResponse.length > 0 && jsonResponse[0].output) {
              responseText = jsonResponse[0].output;
            } else if (jsonResponse.output) {
              responseText = jsonResponse.output;
            } else {
              responseText = rawResponse;
            }
          } catch {
            responseText = rawResponse;
          }
        } else {
          const errorBody = await webhookResponse.text();
          console.error('Retry webhook error:', webhookResponse.status, errorBody);
          responseText = `Webhook error: ${webhookResponse.status}`;
        }
        
        // Update the item in database
        const { error: updateError } = await supabase
          .from('news_items')
          .update({
            response_text: responseText,
            processed_at: new Date().toISOString()
          })
          .eq('id', retryItem.id);
        
        if (updateError) {
          console.error('Error updating item:', updateError);
          throw updateError;
        }
        
        const isError = responseText.startsWith('Webhook error:');
        
        return new Response(
          JSON.stringify({ 
            success: !isError, 
            message: isError ? 'Retry failed' : 'Retry successful',
            response_text: responseText
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
        
      } catch (retryError) {
        console.error('Error during retry:', retryError);
        return new Response(
          JSON.stringify({ success: false, error: 'Retry failed' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }
    
    console.log('Enabled sources:', enabledSources.map(s => RSS_SOURCES[s].name).join(', '));

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

    let totalProcessed = 0;
    let totalInFeed = 0;
    const sourceResults: Record<string, { processed: number; total: number }> = {};

    // Process each enabled source
    for (const sourceKey of enabledSources) {
      const source = RSS_SOURCES[sourceKey];
      console.log(`\n--- Processing source: ${source.name} ---`);
      console.log('Fetching RSS feed from:', source.url);
      
      try {
        // Fetch RSS feed
        const rssResponse = await fetch(source.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; RSSReader/1.0)',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*'
          }
        });
        
        if (!rssResponse.ok) {
          console.error(`Failed to fetch ${source.name} RSS: ${rssResponse.status} ${rssResponse.statusText}`);
          sourceResults[sourceKey] = { processed: 0, total: 0 };
          continue;
        }
        
        const rssText = await rssResponse.text();
        console.log('RSS feed fetched, length:', rssText.length);
        
        // Parse RSS items
        const rssItems = parseRSS(rssText);
        console.log('Parsed RSS items:', rssItems.length);
        totalInFeed += rssItems.length;
        
        if (rssItems.length === 0) {
          sourceResults[sourceKey] = { processed: 0, total: 0 };
          continue;
        }
        
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
            console.log('Calling webhook');
            const webhookResponse = await fetch(WEBHOOK_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*',
              },
              body: JSON.stringify({
                link: item.link,
                title: item.title,
                source: source.name,
                timestamp: new Date().toISOString()
              })
            });
            
            console.log('Webhook response status:', webhookResponse.status);
            
            let responseText = '';
            
            if (webhookResponse.ok) {
              const rawResponse = await webhookResponse.text();
              console.log('Webhook raw response for', item.link, ':', rawResponse.substring(0, 100));
              
              // Parse JSON and extract the "output" field
              try {
                const jsonResponse = JSON.parse(rawResponse);
                if (Array.isArray(jsonResponse) && jsonResponse.length > 0 && jsonResponse[0].output) {
                  responseText = jsonResponse[0].output;
                } else if (jsonResponse.output) {
                  responseText = jsonResponse.output;
                } else {
                  responseText = rawResponse;
                }
              } catch {
                responseText = rawResponse;
              }
              
              console.log('Extracted text:', responseText.substring(0, 100));
            } else {
              const errorBody = await webhookResponse.text();
              console.error('Webhook error:', webhookResponse.status, errorBody);
              console.log('Skipping database insert for failed item:', item.link);
              // Don't store failed items - they will be retried on next run
              continue;
            }
            
            // Send to Microsoft Teams webhook if enabled
            if (teamsEnabled && TEAMS_WEBHOOK_URL) {
              console.log('Sending to Teams webhook');
              try {
                const teamsResponse = await fetch(TEAMS_WEBHOOK_URL, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/plain, */*',
                  },
                  body: JSON.stringify({
                    link: item.link,
                    title: item.title,
                    source: source.name,
                    responseText: responseText,
                    timestamp: new Date().toISOString()
                  })
                });
                console.log('Teams webhook response status:', teamsResponse.status);
                if (!teamsResponse.ok) {
                  const teamsError = await teamsResponse.text();
                  console.error('Teams webhook error:', teamsResponse.status, teamsError);
                }
              } catch (teamsError) {
                console.error('Error sending to Teams:', teamsError);
              }
            }
            
            // Only store successful items in database
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
            } else {
              processedCount++;
              existingLinks.add(item.link); // Prevent duplicates across sources
            }
            
          } catch (itemError) {
            console.error('Error processing item:', item.link, itemError);
          }
        }
        
        sourceResults[sourceKey] = { processed: processedCount, total: rssItems.length };
        totalProcessed += processedCount;
        
      } catch (sourceError) {
        console.error(`Error processing source ${source.name}:`, sourceError);
        sourceResults[sourceKey] = { processed: 0, total: 0 };
      }
    }
    
    console.log('\nProcessing complete. Total processed:', totalProcessed);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Processed ${totalProcessed} new items`,
        processed: totalProcessed,
        total_in_feed: totalInFeed,
        sources: sourceResults
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
