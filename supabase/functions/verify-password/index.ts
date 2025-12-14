import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Rate limiting configuration
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// In-memory rate limiting store (resets on function cold start, but provides good protection)
const rateLimitStore = new Map<string, { attempts: number; lastAttempt: number; lockedUntil: number }>();

function getClientIP(req: Request): string {
  // Try to get real IP from various headers
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  // Fallback - use a hash of user agent as additional identifier
  return req.headers.get('user-agent')?.slice(0, 50) || 'unknown';
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = rateLimitStore.get(ip);
  
  if (!record) {
    return { allowed: true };
  }
  
  // Check if still locked out
  if (record.lockedUntil > now) {
    const retryAfter = Math.ceil((record.lockedUntil - now) / 1000);
    return { allowed: false, retryAfter };
  }
  
  // Reset if lockout expired
  if (record.lockedUntil > 0 && record.lockedUntil <= now) {
    rateLimitStore.delete(ip);
    return { allowed: true };
  }
  
  // Check if too many attempts
  if (record.attempts >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_DURATION_MS;
    rateLimitStore.set(ip, record);
    const retryAfter = Math.ceil(LOCKOUT_DURATION_MS / 1000);
    return { allowed: false, retryAfter };
  }
  
  return { allowed: true };
}

function recordAttempt(ip: string, success: boolean): void {
  const now = Date.now();
  
  if (success) {
    // Clear rate limit on successful auth
    rateLimitStore.delete(ip);
    return;
  }
  
  const record = rateLimitStore.get(ip) || { attempts: 0, lastAttempt: 0, lockedUntil: 0 };
  record.attempts += 1;
  record.lastAttempt = now;
  rateLimitStore.set(ip, record);
}

// Generate a simple signed token (HMAC-based)
async function generateToken(payload: object, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '');
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '');
  const data = `${headerB64}.${payloadB64}`;
  
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  
  return `${data}.${signatureB64}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIP = getClientIP(req);
  console.log(`Password verification attempt from IP: ${clientIP.substring(0, 10)}...`);

  try {
    // Check rate limit first
    const rateLimitResult = checkRateLimit(clientIP);
    if (!rateLimitResult.allowed) {
      console.log(`Rate limit exceeded for IP: ${clientIP.substring(0, 10)}...`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Too many login attempts. Please try again later.',
          retryAfter: rateLimitResult.retryAfter 
        }), 
        {
          status: 429,
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json',
            'Retry-After': String(rateLimitResult.retryAfter)
          },
        }
      );
    }

    const { password } = await req.json();
    const appPassword = Deno.env.get('APP_PASSWORD');
    const jwtSecret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'); // Use service role key as signing secret

    if (!appPassword) {
      console.error('APP_PASSWORD not configured');
      return new Response(JSON.stringify({ success: false, error: 'Server configuration error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isValid = password === appPassword;
    
    // Record the attempt for rate limiting
    recordAttempt(clientIP, isValid);
    
    console.log('Password verification attempt:', isValid ? 'success' : 'failed');

    if (isValid && jwtSecret) {
      // Generate a signed token that expires in 180 days
      const expiresAt = Date.now() + (180 * 24 * 60 * 60 * 1000);
      const token = await generateToken(
        { 
          authenticated: true, 
          exp: expiresAt,
          iat: Date.now()
        }, 
        jwtSecret
      );
      
      return new Response(JSON.stringify({ success: true, token }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: isValid }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in verify-password function:', error);
    return new Response(JSON.stringify({ success: false, error: 'Authentication failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
