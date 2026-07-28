/**
 * Shared auth + CORS for edge functions.
 *
 * WHY THIS EXISTS
 * ---------------
 * Setting `verify_jwt = true` is NOT sufficient on its own. The anon /
 * publishable key is itself a valid signed JWT, so the platform gateway
 * happily accepts it — and that key ships in the public browser bundle.
 * Every function that should be user-only must therefore ALSO resolve the
 * token to a real user. `getUser()` returns null for a bare anon key, which
 * is exactly the distinction we need.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Only the live app may call these functions from a browser. */
const ALLOWED_ORIGINS = [
  "https://ashapp.atlasai-agents.com",
  "http://localhost:8080",
];

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

export interface AuthedUser {
  userId: string;
  email: string | null;
}

/**
 * Resolve the caller to a real signed-in user.
 * Returns a 401 Response if the caller is anonymous or presenting only the
 * anon key. Callers MUST check `instanceof Response` before proceeding.
 */
export async function requireUser(req: Request): Promise<AuthedUser | Response> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();

  if (!token) return jsonResponse(req, { error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );

  const { data, error } = await supabase.auth.getUser(token);

  // A bare anon key parses as a JWT but resolves to no user — rejected here.
  if (error || !data?.user) {
    return jsonResponse(req, { error: "Unauthorized" }, 401);
  }

  return { userId: data.user.id, email: data.user.email ?? null };
}

/**
 * Service-to-service guard for the pg_cron scheduler.
 * The secret lives in `public.cron_secrets` (admin-only RLS) and is compared
 * with a constant-time check so the endpoint can't be probed byte by byte.
 */
export async function requireCronSecret(req: Request): Promise<true | Response> {
  const presented = req.headers.get("x-cron-secret") ?? "";
  if (!presented) return jsonResponse(req, { error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabase
    .from("cron_secrets")
    .select("secret")
    .eq("name", "run-scheduled-posts")
    .single();

  if (error || !data?.secret) {
    return jsonResponse(req, { error: "Unauthorized" }, 401);
  }

  if (!constantTimeEquals(presented, data.secret)) {
    return jsonResponse(req, { error: "Unauthorized" }, 401);
  }

  return true;
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
