/**
 * ash-r2-proxy — Cloudflare Worker
 *
 * Authenticated:
 *   POST   /sign-read      → presigned GET URLs for private media (batched)
 *   POST   /upload/small   → streams files ≤50MB directly to R2
 *   POST   /presign        → presigned PUT URL for large direct-to-R2 uploads
 *   DELETE /file/:key      → removes an object
 *
 * Public:
 *   GET    /thumb/<key>    → thumbnails only, so already-published posts on
 *                            Ash's public website keep rendering. Locked to the
 *                            `thumbs/` prefix — a video key here gets a 404.
 *
 * Auth is a Supabase session JWT (browser) or X-Service-Secret (server jobs).
 * See auth.ts for why "is this a valid JWT" is not a sufficient check.
 */

import { authenticate, type Caller } from './auth';
import type { Env } from './env';
import { isThumbKey, isValidKey } from './keys';
import { presign, r2Client } from './sign';

/** Browsers get short-lived URLs; server jobs download whole videos and need longer. */
const MAX_EXPIRY_USER = 2 * 60 * 60;      // 2h
const MAX_EXPIRY_SERVICE = 12 * 60 * 60;  // 12h
const DEFAULT_EXPIRY = 2 * 60 * 60;
const MAX_KEYS_PER_REQUEST = 200;

const UPLOAD_EXPIRY = 60 * 60;
const SMALL_FILE_CACHE = 'public, max-age=31536000, immutable';

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Service-Secret',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(env), 'Content-Type': 'application/json' },
  });
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * Public thumbnail read. Ash's website stores thumbnail URLs when a video is
 * published and hotlinks them forever, so this path cannot require auth. It is
 * deliberately narrow: thumbs only, GET only, no listing, and keys are random
 * so the prefix cannot be enumerated.
 */
async function serveThumb(key: string, env: Env): Promise<Response> {
  if (!isThumbKey(key)) return json({ error: 'Not found' }, 404, env);

  const object = await env.BUCKET.get(key);
  if (!object) return json({ error: 'Not found' }, 404, env);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', SMALL_FILE_CACHE);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('X-Content-Type-Options', 'nosniff');

  return new Response(object.body, { headers });
}

async function signRead(request: Request, caller: Caller, env: Env): Promise<Response> {
  let body: { keys?: unknown; expiresIn?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, env);
  }

  const keys = body.keys;
  if (!Array.isArray(keys) || keys.length === 0) {
    return json({ error: 'Missing keys' }, 400, env);
  }
  if (keys.length > MAX_KEYS_PER_REQUEST) {
    return json({ error: `Too many keys (max ${MAX_KEYS_PER_REQUEST})` }, 400, env);
  }

  const unique = [...new Set(keys.filter((k): k is string => typeof k === 'string'))];
  const invalid = unique.filter((k) => !isValidKey(k));
  if (invalid.length > 0) {
    return json({ error: `Invalid key: ${invalid[0]}` }, 400, env);
  }

  const ceiling = caller.kind === 'service' ? MAX_EXPIRY_SERVICE : MAX_EXPIRY_USER;
  const requested = typeof body.expiresIn === 'number' ? body.expiresIn : DEFAULT_EXPIRY;
  const expiresIn = Math.min(Math.max(Math.floor(requested), 60), ceiling);

  try {
    const client = r2Client(env);
    const signed = await Promise.all(
      unique.map(async (key) => [key, await presign(client, env, key, 'GET', expiresIn)] as const),
    );

    return json(
      { urls: Object.fromEntries(signed), expiresIn },
      200,
      env,
    );
  } catch (err) {
    return json({ error: `Sign failed: ${message(err)}` }, 500, env);
  }
}

async function uploadSmall(request: Request, env: Env): Promise<Response> {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const key = (formData.get('key') as string | null) ?? '';

  if (!file || !key) return json({ error: 'Missing file or key' }, 400, env);
  if (!isValidKey(key)) return json({ error: 'Invalid key' }, 400, env);

  try {
    await env.BUCKET.put(key, file.stream(), {
      httpMetadata: { contentType: file.type, cacheControl: SMALL_FILE_CACHE },
    });
    return json({ key, url: `${env.R2_PUBLIC_URL}/${key}` }, 200, env);
  } catch (err) {
    return json({ error: `R2 put failed: ${message(err)}` }, 500, env);
  }
}

async function presignUpload(request: Request, env: Env): Promise<Response> {
  let body: { key?: string; contentType?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, env);
  }

  if (!body?.key || !body?.contentType) {
    return json({ error: 'Missing key or contentType' }, 400, env);
  }
  if (!isValidKey(body.key)) return json({ error: 'Invalid key' }, 400, env);

  try {
    const url = await presign(r2Client(env), env, body.key, 'PUT', UPLOAD_EXPIRY, body.contentType);
    return json({ presignedUrl: url, publicUrl: `${env.R2_PUBLIC_URL}/${body.key}` }, 200, env);
  } catch (err) {
    return json({ error: `Presign failed: ${message(err)}` }, 500, env);
  }
}

async function deleteFile(key: string, env: Env): Promise<Response> {
  if (!key) return json({ error: 'Missing key' }, 400, env);
  if (!isValidKey(key)) return json({ error: 'Invalid key' }, 400, env);

  try {
    await env.BUCKET.delete(key);
    return json({ success: true }, 200, env);
  } catch (err) {
    return json({ error: `Delete failed: ${message(err)}` }, 500, env);
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Entry point ──────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    const path = new URL(request.url).pathname;

    // Public route — must be handled before the auth gate.
    if (request.method === 'GET' && path.startsWith('/thumb/')) {
      return serveThumb(decodeURIComponent(path.slice('/thumb/'.length)), env);
    }

    const caller = await authenticate(request, env);
    if (!caller) return json({ error: 'Unauthorized' }, 401, env);

    if (request.method === 'POST' && path === '/sign-read') return signRead(request, caller, env);
    if (request.method === 'POST' && path === '/upload/small') return uploadSmall(request, env);
    if (request.method === 'POST' && path === '/presign') return presignUpload(request, env);
    if (request.method === 'DELETE' && path.startsWith('/file/')) {
      return deleteFile(decodeURIComponent(path.slice('/file/'.length)), env);
    }

    return json({ error: 'Not found' }, 404, env);
  },
};
