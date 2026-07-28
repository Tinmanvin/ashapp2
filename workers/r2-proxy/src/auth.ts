/**
 * auth.ts — caller identification for the R2 Worker.
 *
 * WHY THIS REPLACED X-Upload-Secret
 * ---------------------------------
 * The old design used a single shared secret that was embedded in the browser
 * bundle as VITE_R2_UPLOAD_SECRET. Anyone who opened devtools could read it and
 * then DELETE /file/:key their way through the entire media library.
 *
 * There are exactly two legitimate kinds of caller:
 *   1. A signed-in human in the browser  → Supabase session JWT
 *   2. A server-side job (edge functions, Trigger.dev) → SERVICE_SECRET
 *
 * The Supabase anon/publishable key is itself a valid signed JWT and ships in
 * the public bundle, so "is this a well-formed JWT" is NOT a sufficient test.
 * We resolve the token against Supabase's /auth/v1/user, which returns 401 for
 * a bare anon key — that is the distinction that actually matters.
 */

import type { Env } from './env';

export type Caller =
  | { kind: 'user'; userId: string; token: string }
  | { kind: 'service' };

/**
 * Narrow a set of storage keys to the ones this caller is allowed to read.
 *
 * Delegated to Postgres rather than reimplemented here: the RPC runs under the
 * caller's own JWT, so ownership follows the same RLS policies as the rest of
 * the app — including admin access — and there is no second rule set to drift.
 *
 * Fails closed. A signing endpoint that authorized everything on a network
 * blip would be worse than one that briefly stops serving images.
 */
export async function filterOwnedKeys(
  keys: string[],
  caller: Caller,
  env: Env,
): Promise<string[]> {
  if (caller.kind === 'service') return keys;

  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/filter_owned_media_keys`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${caller.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ keys }),
    });

    if (!res.ok) return [];

    const allowed = await res.json() as unknown;
    return Array.isArray(allowed) ? allowed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/** Positive-only token cache, scoped to this isolate. Failures are never cached. */
const TOKEN_CACHE = new Map<string, { userId: string; expiresAt: number }>();
const TOKEN_CACHE_TTL_MS = 60_000;

export async function authenticate(request: Request, env: Env): Promise<Caller | null> {
  const serviceSecret = request.headers.get('X-Service-Secret');
  if (serviceSecret && env.SERVICE_SECRET && constantTimeEquals(serviceSecret, env.SERVICE_SECRET)) {
    return { kind: 'service' };
  }

  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const cached = TOKEN_CACHE.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return { kind: 'user', userId: cached.userId, token };
  }

  const userId = await resolveUser(token, env);
  if (!userId) return null;

  TOKEN_CACHE.set(token, { userId, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
  if (TOKEN_CACHE.size > 500) pruneCache();

  return { kind: 'user', userId, token };
}

async function resolveUser(token: string, env: Env): Promise<string | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;

  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: env.SUPABASE_ANON_KEY,
      },
    });

    if (!res.ok) return null;

    const user = await res.json() as { id?: string } | null;
    return user?.id ?? null;
  } catch {
    return null;
  }
}

function pruneCache(): void {
  const now = Date.now();
  for (const [token, entry] of TOKEN_CACHE) {
    if (entry.expiresAt <= now) TOKEN_CACHE.delete(token);
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
