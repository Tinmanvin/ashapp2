/**
 * mediaUrl.ts — the one place that knows how a stored media URL becomes a
 * URL the browser can actually load.
 *
 * THE INVARIANT
 * -------------
 * The **canonical** form of every media URL is `${R2_PUBLIC_URL}/${key}`.
 * That is what lives in the database and what crosses any process boundary
 * (edge-function payloads, Trigger.dev tasks, the website API).
 *
 * A **signed** URL is short-lived, display-only, and MUST NEVER be persisted.
 * Writing one to the database would look fine for two hours and then rot, so
 * app objects deliberately carry both: `fileUrl`/`previewUrl` stay canonical,
 * and `fileSrc`/`previewSrc` hold the signed value for <img>/<video>.
 *
 * The bucket is private, so a canonical URL no longer resolves on its own —
 * it is an identifier, not a fetchable address.
 */

import { supabase } from '@/lib/supabase';

const WORKER_URL = (import.meta.env.VITE_R2_WORKER_URL as string | undefined) ?? '';
const PUBLIC_BASE = (
  (import.meta.env.VITE_R2_PUBLIC_URL as string | undefined) ??
  'https://pub-ff0f532390a54125911cf9b775c00b43.r2.dev'
).replace(/\/+$/, '');

/** Re-sign this far before actual expiry so a URL never dies mid-render. */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

const cache = new Map<string, { url: string; expiresAt: number }>();

// ── Key extraction ───────────────────────────────────────────────────────────

/**
 * Reduce any form of media URL to its storage key.
 * Returns null for URLs that are not ours (Supabase Storage fallback, data:,
 * blob:, Google Drive) — those are passed through untouched by callers.
 */
export function mediaKey(url: string | null | undefined): string | null {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return null;

  if (url.startsWith(`${PUBLIC_BASE}/`)) {
    return stripQuery(url.slice(PUBLIC_BASE.length + 1)) || null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const path = parsed.pathname.replace(/^\/+/, '');

  // Already-signed S3 URL: /<bucket>/<key>
  if (parsed.hostname.endsWith('.r2.cloudflarestorage.com')) {
    const slash = path.indexOf('/');
    return slash === -1 ? null : decodeURIComponent(path.slice(slash + 1)) || null;
  }

  // Legacy public dev URL, in case R2_PUBLIC_URL is ever reconfigured
  if (/^pub-[a-z0-9]+\.r2\.dev$/.test(parsed.hostname)) {
    return decodeURIComponent(path) || null;
  }

  // Public thumbnail route on our own Worker
  if (WORKER_URL && url.startsWith(`${WORKER_URL}/thumb/`)) {
    return decodeURIComponent(path.replace(/^thumb\//, '')) || null;
  }

  return null;
}

/** Canonical form, for anything about to be persisted or sent to a server. */
export function toCanonical(url: string | null | undefined): string {
  if (!url) return '';
  const key = mediaKey(url);
  return key ? `${PUBLIC_BASE}/${key}` : url;
}

export function canonicalFromKey(key: string): string {
  return `${PUBLIC_BASE}/${key}`;
}

/** Publicly readable thumbnail URL — the only media path that needs no auth. */
export function thumbPublicUrl(url: string | null | undefined): string {
  const key = mediaKey(url);
  if (!key || !key.startsWith('thumbs/') || !WORKER_URL) return url ?? '';
  return `${WORKER_URL}/thumb/${key}`;
}

function stripQuery(s: string): string {
  const q = s.indexOf('?');
  return q === -1 ? s : s.slice(0, q);
}

// ── Signing ──────────────────────────────────────────────────────────────────

/**
 * Sign a batch of media URLs. Input order is irrelevant; the result maps the
 * URL you passed in to a loadable one. URLs that are not ours map to themselves
 * so callers can hand this straight to an <img src>.
 *
 * Batched on purpose: the media library renders ~50 thumbnails at once, and one
 * round trip per thumbnail would be worse than the problem being solved.
 */
export async function signMediaUrls(urls: (string | null | undefined)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = new Map<string, string[]>(); // key → source urls needing it

  for (const url of urls) {
    if (!url) continue;
    const key = mediaKey(url);
    if (!key) {
      out.set(url, url);
      continue;
    }

    // Thumbnails are served unauthenticated by the Worker (Ash's website
    // hotlinks them), so they need no signature. Resolving them here keeps the
    // whole library grid off the signing path and covers custom thumbnails,
    // which have no database row to check ownership against.
    if (key.startsWith('thumbs/')) {
      out.set(url, thumbPublicUrl(url));
      continue;
    }

    const hit = cache.get(key);
    if (hit && hit.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
      out.set(url, hit.url);
      continue;
    }

    const existing = wanted.get(key);
    if (existing) existing.push(url);
    else wanted.set(key, [url]);
  }

  if (wanted.size === 0) return out;

  const signed = await requestSignatures([...wanted.keys()]);

  for (const [key, sources] of wanted) {
    const url = signed.get(key);
    for (const source of sources) {
      // On failure fall back to the canonical URL rather than an empty src, so
      // a signing outage degrades to a broken image instead of a blank layout.
      out.set(source, url ?? source);
    }
  }

  return out;
}

/** Single-URL convenience. Prefer signMediaUrls for anything list-shaped. */
export async function signMediaUrl(url: string | null | undefined): Promise<string> {
  if (!url) return '';
  const map = await signMediaUrls([url]);
  return map.get(url) ?? url;
}

// ── Request batching ─────────────────────────────────────────────────────────
//
// Components sign their own URLs independently, which would otherwise be one
// HTTP request per thumbnail. Keys requested inside the same tick are collected
// and sent as a single call, so a 50-image grid costs one round trip.

const MAX_KEYS_PER_REQUEST = 200;

let pendingKeys = new Set<string>();
let pendingFlush: Promise<Map<string, string>> | null = null;

function requestSignatures(keys: string[]): Promise<Map<string, string>> {
  for (const key of keys) pendingKeys.add(key);

  if (!pendingFlush) {
    pendingFlush = new Promise((resolve) => {
      queueMicrotask(() => {
        const batch = [...pendingKeys];
        pendingKeys = new Set();
        pendingFlush = null;
        resolve(fetchSignatures(batch));
      });
    }).then((r) => r as Map<string, string>);
  }

  return pendingFlush;
}

async function fetchSignatures(keys: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!WORKER_URL || keys.length === 0) return result;

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return result;

  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += MAX_KEYS_PER_REQUEST) {
    chunks.push(keys.slice(i, i + MAX_KEYS_PER_REQUEST));
  }

  await Promise.all(chunks.map(async (chunk) => {
    try {
      const res = await fetch(`${WORKER_URL}/sign-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ keys: chunk }),
      });

      if (!res.ok) return;

      const body = await res.json() as { urls?: Record<string, string>; expiresIn?: number };
      const expiresAt = Date.now() + (body.expiresIn ?? 7200) * 1000;

      for (const [key, url] of Object.entries(body.urls ?? {})) {
        cache.set(key, { url, expiresAt });
        result.set(key, url);
      }
    } catch {
      // Network failure — callers fall back to canonical URLs.
    }
  }));

  return result;
}

/** Drop cached signatures. Call on sign-out so a shared machine leaks nothing. */
export function clearMediaUrlCache(): void {
  cache.clear();
}
