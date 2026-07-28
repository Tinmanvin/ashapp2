import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUserOrService } from "../_shared/auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "https://ashapp.atlasai-agents.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Vary": "Origin",
};

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

const CHANNEL_MAP: Record<string, string> = {
  telegram_free: Deno.env.get("TELEGRAM_FREE_CHANNEL_ID") ?? "",
  telegram_vip:  Deno.env.get("TELEGRAM_VIP_CHANNEL_ID") ?? "",
  telegram_test: Deno.env.get("TELEGRAM_TEST_CHANNEL_ID") ?? "",
};

interface GroupItem {
  fileUrl: string;
  fileType: "image" | "video";
  width?: number;
  height?: number;
  duration?: number;
}

// Give every thought its own line with a blank line between — Ash's spaced style.
// OpenAI sometimes returns single newlines (cramped) or inconsistent spacing.
function normalizeCaption(text: string): string {
  if (!text) return text;
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n\n");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function fetchAsFile(item: GroupItem, idx: number): Promise<File> {
  const res = await fetch(item.fileUrl);
  if (!res.ok) throw new Error(`Failed to fetch file ${idx}: ${res.status} ${res.statusText}`);
  const blob = await res.blob();
  const isVideo = item.fileType === "video";
  // Always set explicit MIME — R2 may serve application/octet-stream which makes
  // Telegram treat videos as documents.
  const contentType = isVideo ? "video/mp4" : (blob.type || "image/jpeg");
  const rawName = item.fileUrl.split("/").pop()?.split("?")[0] ?? "";
  const filename = rawName || (isVideo ? `file${idx}.mp4` : `file${idx}.jpg`);
  return new File([blob], filename, { type: contentType });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Must be a signed-in user. Rejects anonymous callers AND the bare anon key,
  // which is public in the browser bundle. Without this, anyone on the internet
  // could publish arbitrary media to Ash's Telegram channels.
  const auth = await requireUserOrService(req);
  if (auth instanceof Response) return auth;

  try {
    const payload = await req.json() as {
      platform: string;
      // Single-post shape (unchanged):
      fileUrl?: string;
      fileType?: "image" | "video";
      caption?: string;
      width?: number;
      height?: number;
      duration?: number;
      // Group shape (2+ items → native album):
      items?: GroupItem[];
    };

    const { platform } = payload;
    const caption = normalizeCaption(payload.caption ?? "");

    if (!BOT_TOKEN) return json({ success: false, error: "TELEGRAM_BOT_TOKEN not set" });

    const chatId = CHANNEL_MAP[platform];
    if (!chatId) return json({ success: false, error: `Unknown platform: ${platform}` });

    // ── Group path: sendMediaGroup (native album) ────────────────────────────
    if (payload.items && payload.items.length >= 2) {
      const items = payload.items;
      const form = new FormData();
      form.append("chat_id", chatId);

      const media: Record<string, unknown>[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const attachName = `file${i}`;
        form.append(attachName, await fetchAsFile(it, i));

        const isVideo = it.fileType === "video";
        const m: Record<string, unknown> = {
          type: isVideo ? "video" : "photo",
          media: `attach://${attachName}`,
        };
        // Caption lives on the FIRST item only — Telegram renders it under the album.
        if (i === 0 && caption) m.caption = caption;
        if (isVideo) {
          m.supports_streaming = true;
          // Preserve per-video dimensions so portrait videos don't stretch on mobile.
          if (it.width && it.height) { m.width = it.width; m.height = it.height; }
          if (it.duration) m.duration = it.duration;
        }
        media.push(m);
      }
      form.append("media", JSON.stringify(media));

      const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMediaGroup`, {
        method: "POST",
        body: form,
      });
      const tgData = await tgRes.json();

      if (!tgData.ok) {
        console.error("[post-telegram] sendMediaGroup error:", JSON.stringify(tgData));
        return json({ success: false, error: tgData.description, tgCode: tgData.error_code, tgData });
      }
      return json({ success: true, message_ids: (tgData.result ?? []).map((m: { message_id: number }) => m.message_id) });
    }

    // ── Single path (unchanged behaviour) ────────────────────────────────────
    const single: GroupItem | undefined = payload.items?.[0] ?? (
      payload.fileUrl && payload.fileType
        ? { fileUrl: payload.fileUrl, fileType: payload.fileType, width: payload.width, height: payload.height, duration: payload.duration }
        : undefined
    );
    if (!single) return json({ success: false, error: "No file provided" });

    const isVideo = single.fileType === "video";
    const file = await fetchAsFile(single, 0);

    const method   = isVideo ? "sendVideo" : "sendPhoto";
    const mediaKey = isVideo ? "video" : "photo";

    const form = new FormData();
    form.append("chat_id", chatId);
    form.append(mediaKey, file);
    if (caption) form.append("caption", caption);
    if (isVideo) {
      form.append("supports_streaming", "true");
      if (single.width && single.height) {
        form.append("width", String(single.width));
        form.append("height", String(single.height));
      }
      if (single.duration) form.append("duration", String(single.duration));
    }

    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: "POST",
      body: form,
    });
    const tgData = await tgRes.json();

    if (!tgData.ok) {
      console.error("[post-telegram] Telegram error:", JSON.stringify(tgData));
      return json({ success: false, error: tgData.description, tgCode: tgData.error_code, tgData });
    }

    return json({ success: true, message_id: tgData.result?.message_id });

  } catch (err) {
    console.error("[post-telegram] Unexpected error:", err);
    return json({ success: false, error: String(err) });
  }
});
