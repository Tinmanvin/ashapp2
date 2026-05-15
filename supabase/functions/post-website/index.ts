import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const API_KEY  = (Deno.env.get("WEBSITE_API_KEY") ?? "").trim();
const BASE_URL = "https://blackmagicmodel.com";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { fileUrl, title, externalId, categories, tags, thumbnailUrl } = await req.json() as {
      fileUrl:      string;
      title:        string;
      externalId:   string;
      categories?:  string[];
      tags?:        string[];
      thumbnailUrl?: string;
    };

    if (!API_KEY) {
      return new Response(JSON.stringify({ error: "WEBSITE_API_KEY not configured" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const cats = categories ?? [];
    // API accepts a single category string
    const category = cats[0] ?? "";
    const playbackPolicy = category === "Free" ? "signed" : "drm";

    const payload = {
      title,
      description:     "",
      scheduled_at:    null,
      tags:            tags ?? [],
      category,
      playback_policy: playbackPolicy,
      thumbnail_url:   thumbnailUrl ?? "",
      external_id:     externalId,
      source:          "ContentHub",
    };

    // Step 1: POST metadata → get upload_url
    const metaRes = await fetch(`${BASE_URL}/api/publish/uploads`, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type":  "application/json",
        "Accept":        "application/json",
      },
      body: JSON.stringify(payload),
    });

    const metaText = await metaRes.text();
    if (!metaRes.ok) {
      throw new Error(`Metadata POST failed (${metaRes.status}): ${metaText}`);
    }

    const metaData = JSON.parse(metaText) as {
      content_id: number;
      upload_url: string;
      expires_at: string;
      status:     string;
    };

    const { content_id, upload_url } = metaData;

    // upload_url is null when external_id was already registered (idempotent response)
    // In that case the video is already on the platform — treat as success
    if (!upload_url) {
      return new Response(
        JSON.stringify({ success: true, content_id, already_registered: true }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // Step 2: fetch the file and PUT it to the upload_url
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) {
      throw new Error(`Failed to fetch file: ${fileRes.status} ${fileRes.statusText}`);
    }

    const fileBytes   = await fileRes.arrayBuffer();
    const contentType = fileRes.headers.get("content-type") ?? "video/mp4";

    const uploadRes = await fetch(upload_url, {
      method:  "PUT",
      headers: { "Content-Type": contentType },
      body:    fileBytes,
    });

    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      throw new Error(`File upload failed: ${uploadRes.status} ${text}`);
    }

    return new Response(
      JSON.stringify({ success: true, content_id }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );

  } catch (err) {
    console.error("[post-website] Error:", err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
