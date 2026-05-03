/**
 * ash-r2-proxy — Cloudflare Worker
 *
 * Handles all media storage operations for the Ash App:
 *  POST  /upload/small — streams files ≤50MB directly to R2
 *  POST  /presign      — returns a presigned PUT URL for large files (direct-to-R2)
 *  DELETE /file/:key   — removes a file from R2
 *
 * Auth: every request must include X-Upload-Secret header
 */

import { AwsClient } from 'aws4fetch';

export interface Env {
  BUCKET: R2Bucket;
  UPLOAD_SECRET: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  R2_PUBLIC_URL: string;  // e.g. https://pub-xxxx.r2.dev
  ALLOWED_ORIGIN: string; // e.g. https://ashapp.atlasai-agents.com
}

// ── CORS headers ─────────────────────────────────────────────────────────────

function corsHeaders(env: Env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Upload-Secret',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body: unknown, status: number, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(env), 'Content-Type': 'application/json' },
  });
}

// ── Auth check ────────────────────────────────────────────────────────────────

function isAuthorized(request: Request, env: Env): boolean {
  return request.headers.get('X-Upload-Secret') === env.UPLOAD_SECRET;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (!isAuthorized(request, env)) {
      return json({ error: 'Unauthorized' }, 401, env);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ── POST /upload/small ── stream file directly through Worker to R2
    if (request.method === 'POST' && path === '/upload/small') {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      const key = (formData.get('key') as string | null) ?? '';

      if (!file || !key) {
        return json({ error: 'Missing file or key' }, 400, env);
      }

      try {
        await env.BUCKET.put(key, file.stream(), {
          httpMetadata: {
            contentType: file.type,
            cacheControl: 'public, max-age=31536000, immutable',
          },
        });

        const publicUrl = `${env.R2_PUBLIC_URL}/${key}`;
        return json({ key, url: publicUrl }, 200, env);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return json({ error: `R2 put failed: ${msg}` }, 500, env);
      }
    }

    // ── POST /presign ── generate a presigned PUT URL for large files
    if (request.method === 'POST' && path === '/presign') {
      let body: { key: string; contentType: string } | null = null;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON body' }, 400, env);
      }

      if (!body?.key || !body?.contentType) {
        return json({ error: 'Missing key or contentType' }, 400, env);
      }

      try {
        const client = new AwsClient({
          accessKeyId: env.R2_ACCESS_KEY_ID,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY,
          service: 's3',
          region: 'auto',
        });

        // Build the S3-compat endpoint URL for this object
        const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${body.key}`;

        // Sign it as a query-param presigned URL (expires in 1 hour)
        const signedReq = await client.sign(
          new Request(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': body.contentType },
          }),
          { aws: { signQuery: true, allHeaders: true, appendSessionToken: false, expiresIn: 3600 } }
        );

        const presignedUrl = signedReq.url;
        const publicUrl = `${env.R2_PUBLIC_URL}/${body.key}`;

        return json({ presignedUrl, publicUrl }, 200, env);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return json({ error: `Presign failed: ${msg}` }, 500, env);
      }
    }

    // ── DELETE /file/:key ── remove object from R2
    if (request.method === 'DELETE' && path.startsWith('/file/')) {
      const key = decodeURIComponent(path.slice('/file/'.length));
      if (!key) return json({ error: 'Missing key' }, 400, env);

      try {
        await env.BUCKET.delete(key);
        return json({ success: true }, 200, env);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return json({ error: `Delete failed: ${msg}` }, 500, env);
      }
    }

    return json({ error: 'Not found' }, 404, env);
  },
};
