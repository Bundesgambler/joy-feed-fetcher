import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Verify a signed token
async function verifyToken(token: string, secret: string): Promise<{ valid: boolean; payload?: any }> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false };
    }
    
    const [headerB64, payloadB64, signatureB64] = parts;
    const data = `${headerB64}.${payloadB64}`;
    
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    // Convert base64url to regular base64
    const signatureB64Fixed = signatureB64.replace(/-/g, '+').replace(/_/g, '/');
    const signatureBytes = Uint8Array.from(atob(signatureB64Fixed), c => c.charCodeAt(0));
    
    const isValid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(data));
    
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token } = await req.json();
    const jwtSecret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!token || !jwtSecret) {
      return new Response(JSON.stringify({ valid: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await verifyToken(token, jwtSecret);
    
    return new Response(JSON.stringify({ valid: result.valid }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in validate-token function:', error);
    return new Response(JSON.stringify({ valid: false }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
