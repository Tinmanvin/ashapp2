import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Find all pending posts whose scheduled_at has passed
  const { data: duePosts, error: fetchErr } = await supabase
    .from("scheduled_posts")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .limit(50);

  if (fetchErr) {
    console.error("[run-scheduled] Fetch error:", fetchErr.message);
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  if (!duePosts?.length) {
    return new Response(JSON.stringify({ processed: 0 }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Mark as 'posting' immediately to prevent double-fire if cron overlaps
  await supabase
    .from("scheduled_posts")
    .update({ status: "posting" })
    .in("id", duePosts.map((p: { id: string }) => p.id));

  const postOne = async (post: typeof duePosts[number]) => {
    try {
      let result: { data: { success: boolean; error?: string } | null; error: { message: string } | null };

      if (post.platform === "x") {
        result = await supabase.functions.invoke("post-x", {
          body: {
            fileUrl: post.file_url,
            fileType: post.file_type,
            caption: post.caption,
          },
        });
      } else if (post.platform.startsWith("telegram")) {
        result = await supabase.functions.invoke("post-telegram", {
          body: {
            platform: post.platform,
            fileUrl: post.file_url,
            fileType: post.file_type,
            caption: post.caption,
          },
        });
      } else if (post.platform === "website") {
        const wc = post.website_config ?? {};
        result = await supabase.functions.invoke("post-website", {
          body: {
            fileUrl: post.file_url,
            title: wc.title || post.asset_name,
            externalId: post.asset_id,
            categories: wc.categories ?? [],
            tags: wc.tags ?? [],
            thumbnailUrl: wc.thumbnailUrl || post.asset_preview_url || "",
            caption: post.caption ?? "",
          },
        });
      } else {
        await supabase
          .from("scheduled_posts")
          .update({ status: "failed", error: `Unknown platform: ${post.platform}` })
          .eq("id", post.id);
        return { id: post.id, platform: post.platform, ok: false, error: "Unknown platform" };
      }

      const ok = !result.error && result.data?.success === true;
      const errorMsg = result.error?.message
        ?? (result.data?.error ? String(result.data.error) : undefined);

      await supabase
        .from("scheduled_posts")
        .update({
          status: ok ? "posted" : "failed",
          error: ok ? null : (errorMsg ?? "Unknown error"),
          posted_at: ok ? new Date().toISOString() : null,
        })
        .eq("id", post.id);

      return { id: post.id, platform: post.platform, ok, error: errorMsg };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[run-scheduled] Error posting ${post.id}:`, msg);
      await supabase
        .from("scheduled_posts")
        .update({ status: "failed", error: msg })
        .eq("id", post.id);
      return { id: post.id, platform: post.platform, ok: false, error: msg };
    }
  };

  const settled = await Promise.allSettled(duePosts.map(postOne));
  const results = settled.flatMap((r) => r.status === "fulfilled" ? [r.value] : []);

  console.log(`[run-scheduled] Processed ${results.length} posts`);
  return new Response(
    JSON.stringify({ processed: results.length, results }),
    { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
  );
});
