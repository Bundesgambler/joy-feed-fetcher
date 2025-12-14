import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client with service role (bypasses RLS)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let deleteAll = false;
    let itemId: string | null = null;

    try {
      const body = await req.json();
      deleteAll = body.deleteAll === true;
      itemId = body.itemId || null;
    } catch {
      // Invalid body
    }

    if (deleteAll) {
      // Delete all news items
      console.log('Deleting all news items');
      const { error } = await supabase
        .from('news_items')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (error) {
        console.error('Error deleting all items:', error);
        throw error;
      }

      return new Response(
        JSON.stringify({ success: true, message: 'All items deleted' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else if (itemId) {
      // Delete a specific item
      console.log('Deleting item:', itemId);
      const { error } = await supabase
        .from('news_items')
        .delete()
        .eq('id', itemId);

      if (error) {
        console.error('Error deleting item:', error);
        throw error;
      }

      return new Response(
        JSON.stringify({ success: true, message: 'Item deleted' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      return new Response(
        JSON.stringify({ success: false, error: 'No deleteAll or itemId specified' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error) {
    console.error('Error in delete-news function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
