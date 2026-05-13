import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

const CHANNEL_MAP: Record<string, string> = {
  telegram_free:     Deno.env.get("TELEGRAM_FREE_CHANNEL_ID") ?? "",
  telegram_free_vip: Deno.env.get("TELEGRAM_FREE_VIP_CHANNEL_ID") ?? "",
  telegram_vip:      Deno.env.get("TELEGRAM_VIP_CHANNEL_ID") ?? "",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const { platform, fileUrl, fileType, caption } = await req.json() as {
      platform: string;
      fileUrl: string;
      fileType: "image" | "video";
      caption: string;
    };

    if (!BOT_TOKEN) {
      return new Response(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN not set" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const chatId = CHANNEL_MAP[platform];
    if (!chatId) {
      return new Response(JSON.stringify({ error: `Unknown platform: ${platform}` }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const method   = fileType === "video" ? "sendVideo" : "sendPhoto";
    const mediaKey = fileType === "video" ? "video" : "photo";

    const tgBody: Record<string, unknown> = {
      chat_id: chatId,
      [mediaKey]: fileUrl,
      caption: caption ?? "",
    };

    const tgRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tgBody),
      }
    );

    const tgData = await tgRes.json();

    if (!tgData.ok) {
      console.error("[post-telegram] Telegram error:", tgData);
      return new Response(JSON.stringify({ error: tgData.description, tgData }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, message_id: tgData.result?.message_id }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[post-telegram] Unexpected error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
