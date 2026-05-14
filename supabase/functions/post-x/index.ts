import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_KEY            = Deno.env.get("X_API_KEY")            ?? "";
const API_SECRET         = Deno.env.get("X_API_SECRET")         ?? "";
const ACCESS_TOKEN       = Deno.env.get("X_ACCESS_TOKEN")       ?? "";
const ACCESS_TOKEN_SECRET = Deno.env.get("X_ACCESS_TOKEN_SECRET") ?? "";

const UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";
const TWEET_URL  = "https://api.twitter.com/2/tweets";
const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB

// ── OAuth 1.0a helpers ────────────────────────────────────────────────────────

function pct(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, "%21").replace(/'/g, "%27")
    .replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\*/g, "%2A");
}

async function oauthHeader(
  method: string,
  url: string,
  // extra params to include in the OAuth signature base string (form params for urlencoded, query params for GET)
  sigParams: Record<string, string> = {},
): Promise<string> {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const ts    = Math.floor(Date.now() / 1000).toString();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key:     API_KEY,
    oauth_nonce:            nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp:        ts,
    oauth_token:            ACCESS_TOKEN,
    oauth_version:          "1.0",
  };

  const allParams = { ...oauthParams, ...sigParams };
  const paramStr = Object.entries(allParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${pct(k)}=${pct(v)}`)
    .join("&");

  const baseStr  = `${method.toUpperCase()}&${pct(url)}&${pct(paramStr)}`;
  const sigKey   = `${pct(API_SECRET)}&${pct(ACCESS_TOKEN_SECRET)}`;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(sigKey),
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig       = await crypto.subtle.sign("HMAC", key, enc.encode(baseStr));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));

  return "OAuth " + Object.entries({ ...oauthParams, oauth_signature: signature })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${pct(k)}="${pct(v)}"`)
    .join(", ");
}

// ── Twitter media upload steps ────────────────────────────────────────────────

async function mediaInit(
  totalBytes: number,
  mediaType: string,
  mediaCategory: string,
): Promise<string> {
  const params = {
    command:        "INIT",
    total_bytes:    String(totalBytes),
    media_type:     mediaType,
    media_category: mediaCategory,
  };
  const auth = await oauthHeader("POST", UPLOAD_URL, params);
  const res  = await fetch(UPLOAD_URL, {
    method:  "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`INIT failed: ${JSON.stringify(data)}`);
  return data.media_id_string as string;
}

async function mediaAppend(
  mediaId: string,
  chunk: Uint8Array,
  segmentIndex: number,
): Promise<void> {
  // multipart/form-data — body params are NOT included in OAuth signature
  const auth = await oauthHeader("POST", UPLOAD_URL);
  const form = new FormData();
  form.append("command",       "APPEND");
  form.append("media_id",      mediaId);
  form.append("segment_index", String(segmentIndex));
  form.append("media",         new Blob([chunk]), "chunk");

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: auth },
    body:   form,
  });
  if (res.status !== 204 && !res.ok) {
    const text = await res.text();
    throw new Error(`APPEND segment ${segmentIndex} failed: ${text}`);
  }
}

async function mediaFinalize(mediaId: string): Promise<void> {
  const params = { command: "FINALIZE", media_id: mediaId };
  const auth   = await oauthHeader("POST", UPLOAD_URL, params);
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
    const auth = await oauthHeader("GET", UPLOAD_URL, sigParams);
    const res  = await fetch(statusUrl, { headers: { Authorization: auth } });
    const data = await res.json();
    const info = data.processing_info;
    if (!info || info.state === "succeeded") return;
    if (info.state === "failed") throw new Error(`Media processing failed: ${JSON.stringify(info)}`);
    await new Promise(r => setTimeout(r, (info.check_after_secs ?? 3) * 1000));
  }
  throw new Error("Media processing timed out");
}

async function postTweet(text: string, mediaId: string): Promise<unknown> {
  const auth = await oauthHeader("POST", TWEET_URL);
  const res  = await fetch(TWEET_URL, {
    method:  "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body:    JSON.stringify({ text, media: { media_ids: [mediaId] } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Tweet failed: ${JSON.stringify(data)}`);
  return data;
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { fileUrl, fileType, caption } = await req.json() as {
      fileUrl:  string;
      fileType: "image" | "video";
      caption:  string;
    };

    if (!API_KEY || !API_SECRET || !ACCESS_TOKEN || !ACCESS_TOKEN_SECRET) {
      return new Response(JSON.stringify({ error: "X credentials not configured" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) throw new Error(`Failed to fetch file: ${fileRes.status} ${fileRes.statusText}`);
    const fileBytes  = new Uint8Array(await fileRes.arrayBuffer());
    const totalBytes = fileBytes.length;

    let mediaId: string;

    if (fileType === "image") {
      const ext       = fileUrl.split(".").pop()?.toLowerCase();
      const mediaType = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg";
      mediaId = await mediaInit(totalBytes, mediaType, "tweet_image");
      await mediaAppend(mediaId, fileBytes, 0);
      await mediaFinalize(mediaId);
    } else {
      mediaId = await mediaInit(totalBytes, "video/mp4", "tweet_video");
      let segment = 0;
      for (let offset = 0; offset < totalBytes; offset += CHUNK_SIZE) {
        await mediaAppend(mediaId, fileBytes.slice(offset, offset + CHUNK_SIZE), segment++);
      }
      await mediaFinalize(mediaId);
      await pollMediaStatus(mediaId);
    }

    const tweet = await postTweet(caption, mediaId);

    return new Response(
      JSON.stringify({ success: true, tweet }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );

  } catch (err) {
    console.error("[post-x] Error:", err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
