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

// Verify JWT token (used for the app's password-based login)
function padBase64(b64: string): string {
  const padLen = (4 - (b64.length % 4)) % 4;
  return b64 + '='.repeat(padLen);
}

function base64UrlToBase64(b64url: string): string {
  return b64url.replace(/-/g, '+').replace(/_/g, '/');
}

async function verifyToken(token: string, secret: string): Promise<{ valid: boolean; payload?: any }> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false };

    const [headerB64Raw, payloadB64Raw, signatureB64UrlRaw] = parts;
    const data = `${headerB64Raw}.${payloadB64Raw}`;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    // Signature is base64url in our token
    const signatureB64 = padBase64(base64UrlToBase64(signatureB64UrlRaw));
    const signatureBytes = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));

    const isValid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(data));
    if (!isValid) return { valid: false };

    // Header/payload are base64 (padding removed)
    const payloadJson = atob(padBase64(payloadB64Raw));
    const payload = JSON.parse(payloadJson);

    // exp is stored in ms in our app token
    if (payload?.exp && payload.exp < Date.now()) return { valid: false };

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

type RetryItem = { id: string; link: string; title: string | null };

type CheckRssOptions = {
  webhookMode: 'production' | 'test';
  enabledSources: SourceKey[];
  retryItem: RetryItem | null;
  teamsEnabled: boolean;
  teamsMode: 'production' | 'test';
};

function getBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return (m?.[1] || authHeader).trim() || null;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function logRunStart(supabase: any, trigger: string) {
  try {
    const { data, error } = await supabase
      .from('rss_runs')
      .insert({
        trigger,
        success: true,
        processed: 0,
      })
      .select('id');

    if (error) {
      console.error('rss_runs insert error:', error);
      return null;
    }

    const id = Array.isArray(data) && data.length > 0 ? data[0]?.id : null;
    return typeof id === 'string' ? id : null;
  } catch (e) {
    console.error('rss_runs insert unexpected error:', e);
    return null;
  }
}

async function logRunFinish(
  supabase: any,
  runId: string | null,
  update: { success: boolean; processed: number; message?: string | null; error?: string | null }
) {
  if (!runId) return;

  try {
    const { error } = await supabase
      .from('rss_runs')
      .update({
        finished_at: new Date().toISOString(),
        success: update.success,
        processed: update.processed,
        message: update.message ?? null,
        error: update.error ?? null,
      })
      .eq('id', runId);

    if (error) console.error('rss_runs update error:', error);
  } catch (e) {
    console.error('rss_runs update unexpected error:', e);
  }
}

async function processCheckRss(options: CheckRssOptions) {
  const WEBHOOK_URL = getWebhookUrl(options.webhookMode);
  const TEAMS_WEBHOOK_URL = getTeamsWebhookUrl(options.teamsMode);

  if (!WEBHOOK_URL) {
    console.error('Webhook URL not configured');
    throw new Error('Webhook URL not configured');
  }

  console.log(`Using ${options.webhookMode} webhook`);
  console.log(`Teams enabled: ${options.teamsEnabled}, mode: ${options.teamsMode}`);

  // Handle retry for a single item
  if (options.retryItem) {
    console.log('Retrying webhook for item:', options.retryItem.link);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
      const webhookResponse = await fetchWithTimeout(
        WEBHOOK_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
          },
          body: JSON.stringify({
            link: options.retryItem.link,
            title: options.retryItem.title,
            source: 'Retry',
            timestamp: new Date().toISOString(),
          }),
        },
        35_000,
      );

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

      const { error: updateError } = await supabase
        .from('news_items')
        .update({
          response_text: responseText,
          processed_at: new Date().toISOString(),
        })
        .eq('id', options.retryItem.id);

      if (updateError) {
        console.error('Error updating item:', updateError);
        throw updateError;
      }

      const isError = responseText.startsWith('Webhook error:');

      return {
        success: !isError,
        message: isError ? 'Retry failed' : 'Retry successful',
        response_text: responseText,
      };
    } catch (retryError) {
      console.error('Error during retry:', retryError);
      throw retryError;
    }
  }

  console.log('Enabled sources:', options.enabledSources.map((s) => RSS_SOURCES[s].name).join(', '));

  // Check if we're within operating hours (7:00 - 20:00 German time)
  if (!isWithinOperatingHours()) {
    console.log('Outside operating hours (7:00-20:00). Skipping.');
    return {
      success: true,
      message: 'Outside operating hours (7:00-20:00)',
      processed: 0,
    };
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

  const existingLinks = new Set(existingItems?.map((item) => item.link) || []);
  console.log('Existing items in database:', existingLinks.size);

  let totalProcessed = 0;
  let totalInFeed = 0;
  const sourceResults: Record<string, { processed: number; total: number }> = {};

  // Process each enabled source
  for (const sourceKey of options.enabledSources) {
    const source = RSS_SOURCES[sourceKey];
    console.log(`\n--- Processing source: ${source.name} ---`);
    console.log('Fetching RSS feed from:', source.url);

    try {
      const rssResponse = await fetchWithTimeout(
        source.url,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; RSSReader/1.0)',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          },
        },
        25_000,
      );

      if (!rssResponse.ok) {
        console.error(`Failed to fetch ${source.name} RSS: ${rssResponse.status} ${rssResponse.statusText}`);
        sourceResults[sourceKey] = { processed: 0, total: 0 };
        continue;
      }

      const rssText = await rssResponse.text();
      console.log('RSS feed fetched, length:', rssText.length);

      const rssItems = parseRSS(rssText);
      console.log('Parsed RSS items:', rssItems.length);
      totalInFeed += rssItems.length;

      if (rssItems.length === 0) {
        sourceResults[sourceKey] = { processed: 0, total: 0 };
        continue;
      }

      const newItems = rssItems.filter((item) => !existingLinks.has(item.link) && isArticleWithin12Hours(item.pubDate));
      console.log('New items to process (within 12 hours):', newItems.length);

      let processedCount = 0;

      for (const item of newItems) {
        try {
          console.log('Processing item:', item.link);
          console.log('Calling webhook');

          const webhookResponse = await fetchWithTimeout(
            WEBHOOK_URL,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*',
              },
              body: JSON.stringify({
                link: item.link,
                title: item.title,
                source: source.name,
                timestamp: new Date().toISOString(),
              }),
            },
            35_000,
          );

          console.log('Webhook response status:', webhookResponse.status);

          let responseText = '';

          if (webhookResponse.ok) {
            const rawResponse = await webhookResponse.text();
            console.log('Webhook raw response for', item.link, ':', rawResponse.substring(0, 100));

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
            continue;
          }

          if (options.teamsEnabled && TEAMS_WEBHOOK_URL) {
            console.log('Sending to Teams webhook');
            try {
              const teamsResponse = await fetchWithTimeout(
                TEAMS_WEBHOOK_URL,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/plain, */*',
                  },
                  body: JSON.stringify({
                    link: item.link,
                    title: item.title,
                    source: source.name,
                    responseText,
                    timestamp: new Date().toISOString(),
                  }),
                },
                15_000,
              );

              console.log('Teams webhook response status:', teamsResponse.status);
              if (!teamsResponse.ok) {
                const teamsError = await teamsResponse.text();
                console.error('Teams webhook error:', teamsResponse.status, teamsError);
              }
            } catch (teamsError) {
              console.error('Error sending to Teams:', teamsError);
            }
          }

          const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : null;

          const { error: insertError } = await supabase
            .from('news_items')
            .insert({
              link: item.link,
              title: item.title,
              response_text: responseText,
              processed_at: new Date().toISOString(),
              published_at: publishedAt,
            });

          if (insertError) {
            console.error('Error inserting item:', insertError);
          } else {
            processedCount++;
            existingLinks.add(item.link);
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

  return {
    success: true,
    message: `Processed ${totalProcessed} new items`,
    processed: totalProcessed,
    total_in_feed: totalInFeed,
    sources: sourceResults,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('authorization');
    const token = getBearerToken(authHeader);

    // Parse request body to get webhook mode and sources
    let webhookMode: 'production' | 'test' = 'production';
    let enabledSources: SourceKey[] = ['nius', 'jungefreiheit', 'apollonews', 'freilichmagazin'];
    let retryItem: RetryItem | null = null;
    let teamsEnabled = false;
    let teamsMode: 'production' | 'test' = 'production';

    try {
      const body = await req.json();
      if (body.webhookMode === 'test') webhookMode = 'test';
      if (Array.isArray(body.sources) && body.sources.length > 0) {
        enabledSources = body.sources.filter((s: string) => s in RSS_SOURCES) as SourceKey[];
      }
      if (body.retryItem) retryItem = body.retryItem;
      if (body.teamsEnabled === true) teamsEnabled = true;
      if (body.teamsMode === 'test') teamsMode = 'test';
    } catch {
      // No body or invalid JSON, use defaults
    }

    const options: CheckRssOptions = {
      webhookMode,
      enabledSources,
      retryItem,
      teamsEnabled,
      teamsMode,
    };

    // Cron runs should NOT require the app token. Detect by JWT payload role: "anon"
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Check if this is a Supabase anon key call (cron job)
    let isCronCall = false;
    if (token) {
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payloadJson = atob(padBase64(parts[1]));
          const payload = JSON.parse(payloadJson);
          // Supabase anon keys have role: "anon" in the payload
          if (payload?.role === 'anon' && payload?.iss === 'supabase') {
            isCronCall = true;
            console.log('Detected Supabase anon key (cron call)');
          }
        }
      } catch (e) {
        console.log('Could not decode token for cron detection:', e);
      }
    }

    if (isCronCall) {
      console.log('Cron/system call detected. Running in background.');

      // For cron calls, always enable Teams webhook
      const cronOptions: CheckRssOptions = {
        ...options,
        teamsEnabled: true,  // Always send to Teams for cron jobs
      };

      // @ts-ignore - EdgeRuntime is provided by the runtime
      EdgeRuntime.waitUntil(
        (async () => {
          const runId = await logRunStart(admin, 'cron');
          try {
            const result: any = await processCheckRss(cronOptions);
            await logRunFinish(admin, runId, {
              success: !!result?.success,
              processed: Number(result?.processed ?? 0),
              message: result?.message ?? null,
              error: null,
            });
            console.log('Cron run finished:', result);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await logRunFinish(admin, runId, {
              success: false,
              processed: 0,
              message: null,
              error: msg,
            });
            console.error('Cron run failed:', err);
          }
        })(),
      );

      return new Response(JSON.stringify({ success: true, accepted: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Manual calls (UI) still require the app token
    if (!token) {
      console.log('No authorization header provided');
      return new Response(JSON.stringify({ success: false, error: 'Authentication required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!serviceRoleKey) {
      console.error('SUPABASE_SERVICE_ROLE_KEY not configured');
      return new Response(JSON.stringify({ success: false, error: 'Server configuration error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authResult = await verifyToken(token, serviceRoleKey);
    if (!authResult.valid) {
      console.log('Invalid or expired token');
      return new Response(JSON.stringify({ success: false, error: 'Invalid or expired token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('JWT authentication successful');

    const runId = await logRunStart(admin, options.retryItem ? 'retry' : 'manual');

    try {
      const result: any = await processCheckRss(options);
      await logRunFinish(admin, runId, {
        success: !!result?.success,
        processed: Number(result?.processed ?? 0),
        message: result?.message ?? null,
        error: result?.success ? null : (result?.error ?? null),
      });

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logRunFinish(admin, runId, {
        success: false,
        processed: 0,
        message: null,
        error: msg,
      });
      throw err;
    }
  } catch (error) {
    console.error('Error in check-rss function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

