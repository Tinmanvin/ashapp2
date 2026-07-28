/**
 * Shared media-URL handling for edge functions.
 *
 * The R2 bucket is private. A stored `file_url` is now an identifier, not a
 * fetchable address — anything that needs the bytes must ask the Worker for a
 * short-lived signed URL first.
 *
 * Callers hand in whatever they were given. A browser may pass a URL that is
 * already signed (and possibly close to expiry), so every input is reduced to
 * its storage key and re-signed from scratch. That makes this safe to call on
 * any URL from any source.
 */

const WORKER_URL = (Deno.env.get("R2_WORKER_URL") ?? "").replace(/\/+$/, "");
const SERVICE_SECRET = Deno.env.get("R2_SERVICE_SECRET") ?? "";
const PUBLIC_BASE = (Deno.env.get("R2_PUBLIC_URL") ?? "").replace(/\/+$/, "");

/** Server jobs stream whole videos; a browser-length window would break them. */
export const SERVER_EXPIRY_SECONDS = 6 * 60 * 60;

export function mediaKey(url: string | null | undefined): string | null {
  if (!url) return null;

  if (PUBLIC_BASE && url.startsWith(`${PUBLIC_BASE}/`)) {
    return stripQuery(url.slice(PUBLIC_BASE.length + 1)) || null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const path = parsed.pathname.replace(/^\/+/, "");

  if (parsed.hostname.endsWith(".r2.cloudflarestorage.com")) {
    const slash = path.indexOf("/");
    return slash === -1 ? null : decodeURIComponent(path.slice(slash + 1)) || null;
  }

  if (/^pub-[a-z0-9]+\.r2\.dev$/.test(parsed.hostname)) {
    return decodeURIComponent(path) || null;
  }

  if (WORKER_URL && url.startsWith(`${WORKER_URL}/thumb/`)) {
    return decodeURIComponent(path.replace(/^thumb\//, "")) || null;
  }

  return null;
}

/**
 * Publicly readable thumbnail URL.
 *
 * Ash's website stores whatever thumbnail URL we hand it and hotlinks it
 * indefinitely, so it cannot be given anything that expires. Thumbnails — and
 * only thumbnails — are served unauthenticated by the Worker for exactly this
 * reason. Video files are never reachable this way.
 */
export function thumbPublicUrl(url: string | null | undefined): string {
  const key = mediaKey(url);
  if (!key || !key.startsWith("thumbs/") || !WORKER_URL) return url ?? "";
  return `${WORKER_URL}/thumb/${key}`;
}

/**
 * Sign one media URL for server-side reading. Falls back to the input when the
 * URL is not ours (or signing is unavailable) so callers can use the result
 * unconditionally.
 */
export async function signMediaUrl(
  url: string,
  expiresIn = SERVER_EXPIRY_SECONDS,
): Promise<string> {
  const signed = await signMediaUrls([url], expiresIn);
  return signed.get(url) ?? url;
}

export async function signMediaUrls(
  urls: string[],
  expiresIn = SERVER_EXPIRY_SECONDS,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byKey = new Map<string, string[]>();

  for (const url of urls) {
    const key = mediaKey(url);
    if (!key) {
      out.set(url, url);
      continue;
    }
    const existing = byKey.get(key);
    if (existing) existing.push(url);
    else byKey.set(key, [url]);
  }

  if (byKey.size === 0) return out;

  if (!WORKER_URL || !SERVICE_SECRET) {
    console.error("[media] R2_WORKER_URL / R2_SERVICE_SECRET not configured — cannot sign");
    for (const sources of byKey.values()) for (const s of sources) out.set(s, s);
    return out;
  }

  try {
    const res = await fetch(`${WORKER_URL}/sign-read`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Service-Secret": SERVICE_SECRET },
      body: JSON.stringify({ keys: [...byKey.keys()], expiresIn }),
    });

    if (!res.ok) {
      console.error(`[media] sign-read failed (${res.status}): ${await res.text()}`);
      for (const sources of byKey.values()) for (const s of sources) out.set(s, s);
      return out;
    }

    const body = await res.json() as { urls?: Record<string, string> };

    for (const [key, sources] of byKey) {
      const signed = body.urls?.[key];
      for (const source of sources) out.set(source, signed ?? source);
    }
  } catch (err) {
    console.error(`[media] sign-read threw: ${err instanceof Error ? err.message : String(err)}`);
    for (const sources of byKey.values()) for (const s of sources) out.set(s, s);
  }

  return out;
}

function stripQuery(s: string): string {
  const q = s.indexOf("?");
  return q === -1 ? s : s.slice(0, q);
}
