import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createHmac } from "node:crypto";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_KEY             = (Deno.env.get("X_API_KEY")             ?? "").trim();
const API_SECRET          = (Deno.env.get("X_API_SECRET")          ?? "").trim();
const ACCESS_TOKEN        = (Deno.env.get("X_ACCESS_TOKEN")        ?? "").trim();
const ACCESS_TOKEN_SECRET = (Deno.env.get("X_ACCESS_TOKEN_SECRET") ?? "").trim();

const UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";
const TWEET_URL  = "https://api.twitter.com/2/tweets";
const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB

// ── OAuth 1.0a ────────────────────────────────────────────────────────────────

function pct(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, "%21").replace(/'/g, "%27")
    .replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\*/g, "%2A");
}

function oauthHeader(
  method: string,
  url: string,
  requestParams: Record<string, string> = {},
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key:     API_KEY,
    oauth_nonce:            crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp:        String(Math.floor(Date.now() / 1000)),
    oauth_token:            ACCESS_TOKEN,
    oauth_version:          "1.0",
  };

  const allParams = { ...oauthParams, ...requestParams };
  const paramStr = Object.entries(allParams)
    .map(([k, v]) => [pct(k), pct(v)] as [string, string])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const baseStr  = `${method.toUpperCase()}&${pct(url)}&${pct(paramStr)}`;
  const sigKey   = `${pct(API_SECRET)}&${pct(ACCESS_TOKEN_SECRET)}`;
  const signature = createHmac("sha1", sigKey).update(baseStr).digest("base64");

  return "OAuth " + Object.entries({ ...oauthParams, oauth_signature: signature })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${pct(k)}="${pct(v)}"`)
    .join(", ");
}

// ── Twitter media upload steps ────────────────────────────────────────────────

async function mediaInit(totalBytes: number, mediaType: string, mediaCategory: string): Promise<string> {
  const params = { command: "INIT", total_bytes: String(totalBytes), media_type: mediaType, media_category: mediaCategory };
  const auth = oauthHeader("POST", UPLOAD_URL, params);
  const res  = await fetch(UPLOAD_URL, {
    method:  "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`INIT failed: ${JSON.stringify(data)}`);
  return data.media_id_string as string;
}

async function mediaAppend(mediaId: string, chunk: Uint8Array, segmentIndex: number): Promise<void> {
  const auth = oauthHeader("POST", UPLOAD_URL);
  const form = new FormData();
  form.append("command",       "APPEND");
  form.append("media_id",      mediaId);
  form.append("segment_index", String(segmentIndex));
  form.append("media",         new Blob([chunk]), "chunk");

  const res = await fetch(UPLOAD_URL, { method: "POST", headers: { Authorization: auth }, body: form });
  if (res.status !== 204 && !res.ok) {
    const text = await res.text();
    throw new Error(`APPEND segment ${segmentIndex} failed: ${text}`);
  }
}

async function mediaFinalize(mediaId: string): Promise<void> {
  const params = { command: "FINALIZE", media_id: mediaId };
  const auth   = oauthHeader("POST", UPLOAD_URL, params);
  const res    = await fetch(UPLOAD_URL, {
    method:  "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`FINALIZE failed: ${JSON.stringify(data)}`);
}

async function pollMediaStatus(mediaId: string): Promise<void> {
  const sigParams = { command: "STATUS", media_id: mediaId };
  const statusUrl = `${UPLOAD_URL}?command=STATUS&media_id=${mediaId}`;

  for (let i = 0; i < 30; i++) {
    const auth = oauthHeader("GET", UPLOAD_URL, sigParams);
    const res  = await fetch(statusUrl, { headers: { Authorization: auth } });
    const data = await res.json();
    const info = data.processing_info;
    if (!info || info.state === "succeeded") return;
    if (info.state === "failed") throw new Error(`Media processing failed: ${JSON.stringify(info)}`);
    await new Promise(r => setTimeout(r, (info.check_after_secs ?? 3) * 1000));
  }
  throw new Error("Media processing timed out");
}

/** Fetch a file from R2/Storage and upload it to X, returning its media_id. */
async function uploadMedia(fileUrl: string, fileType: "image" | "video"): Promise<string> {
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) throw new Error(`Failed to fetch file: ${fileRes.status} ${fileRes.statusText}`);
  const fileBytes  = new Uint8Array(await fileRes.arrayBuffer());
  const totalBytes = fileBytes.length;

  if (fileType === "image") {
    const ext       = fileUrl.split(".").pop()?.toLowerCase();
    const mediaType = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg";
    const mediaId = await mediaInit(totalBytes, mediaType, "tweet_image");
    await mediaAppend(mediaId, fileBytes, 0);
    await mediaFinalize(mediaId);
    return mediaId;
  }

  const mediaId = await mediaInit(totalBytes, "video/mp4", "tweet_video");
  let segment = 0;
  for (let offset = 0; offset < totalBytes; offset += CHUNK_SIZE) {
    await mediaAppend(mediaId, fileBytes.slice(offset, offset + CHUNK_SIZE), segment++);
  }
  await mediaFinalize(mediaId);
  await pollMediaStatus(mediaId);
  return mediaId;
}

async function postTweet(text: string, mediaIds: string[]): Promise<unknown> {
  const auth = oauthHeader("POST", TWEET_URL);
  const res  = await fetch(TWEET_URL, {
    method:  "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body:    JSON.stringify({ text, media: { media_ids: mediaIds } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Tweet failed: ${JSON.stringify(data)}`);
  return data;
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const payload = await req.json() as {
      // Single-post shape (unchanged):
      fileUrl?:  string;
      fileType?: "image" | "video";
      caption:   string;
      // Group shape (2+ images → one tweet):
      items?: { fileUrl: string; fileType: "image" | "video" }[];
    };
    const caption = payload.caption ?? "";

    if (!API_KEY || !API_SECRET || !ACCESS_TOKEN || !ACCESS_TOKEN_SECRET) {
      return new Response(JSON.stringify({ error: "X credentials not configured" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Normalise to a list of media to upload (single = list of one).
    const items = payload.items?.length
      ? payload.items
      : (payload.fileUrl && payload.fileType
          ? [{ fileUrl: payload.fileUrl, fileType: payload.fileType }]
          : []);

    if (!items.length) throw new Error("No media provided");

    // X allows up to 4 photos, OR exactly 1 video, and cannot mix them.
    const hasVideo = items.some((i) => i.fileType === "video");
    if (hasVideo && items.length > 1) {
      throw new Error("X cannot post multiple media when one is a video");
    }
    const mediaItems = items.slice(0, 4); // hard cap — UI blocks >4, this is belt-and-braces

    const mediaIds: string[] = [];
    for (const it of mediaItems) {
      mediaIds.push(await uploadMedia(it.fileUrl, it.fileType));
    }

    const tweet = await postTweet(caption, mediaIds);

    return new Response(JSON.stringify({ success: true, tweet }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[post-x] Error:", err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
