/**
 * Media URL signing for Trigger.dev jobs.
 *
 * Separate from src/lib/mediaUrl.ts on purpose: that module runs in the browser
 * and signs with the user's session, this one runs on a Trigger.dev machine with
 * no session at all and authenticates with the service secret.
 *
 * The expiry is the important part. Compression downloads a whole 4K source and
 * can run for a long time on a slow link; a browser-length window would make
 * large jobs fail intermittently and look like a network flake.
 */

const JOB_EXPIRY_SECONDS = 12 * 60 * 60;

const PUBLIC_BASE = (process.env.R2_PUBLIC_URL ?? "").replace(/\/+$/, "");

export function mediaKey(url: string | null | undefined): string | null {
  if (!url) return null;

  if (PUBLIC_BASE && url.startsWith(`${PUBLIC_BASE}/`)) {
    const rest = url.slice(PUBLIC_BASE.length + 1);
    const q = rest.indexOf("?");
    return (q === -1 ? rest : rest.slice(0, q)) || null;
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

  return null;
}

/**
 * Sign a media URL for a long-running job. Returns the input unchanged when the
 * URL is not ours, so callers can use the result unconditionally.
 */
export async function signMediaUrlForJob(url: string): Promise<string> {
  const key = mediaKey(url);
  if (!key) return url;

  const workerUrl = (process.env.R2_WORKER_URL ?? "").replace(/\/+$/, "");
  const secret = process.env.R2_SERVICE_SECRET ?? "";

  if (!workerUrl || !secret) {
    throw new Error("R2_WORKER_URL / R2_SERVICE_SECRET not set — cannot read private media");
  }

  const res = await fetch(`${workerUrl}/sign-read`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Service-Secret": secret },
    body: JSON.stringify({ keys: [key], expiresIn: JOB_EXPIRY_SECONDS }),
  });

  if (!res.ok) {
    throw new Error(`sign-read failed (${res.status}): ${await res.text()}`);
  }

  const body = await res.json() as { urls?: Record<string, string> };
  const signed = body.urls?.[key];
  if (!signed) throw new Error(`sign-read returned no URL for ${key}`);

  return signed;
}
