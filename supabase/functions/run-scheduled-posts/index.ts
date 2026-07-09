import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PostRow {
  id: string;
  asset_id: string;
  asset_name: string;
  platform: string;
  caption: string;
  file_url: string;
  file_type: "image" | "video";
  website_config: Record<string, unknown> | null;
  asset_preview_url: string | null;
  group_id: string | null;
  position: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Find all pending posts whose scheduled_at has passed.
  // Limit is generous so a group (up to 10 assets × several platforms) is never split.
  const { data: duePosts, error: fetchErr } = await supabase
    .from("scheduled_posts")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .limit(200);

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

  const rows = duePosts as PostRow[];

  // Mark as 'posting' immediately to prevent double-fire if cron overlaps.
  await supabase
    .from("scheduled_posts")
    .update({ status: "posting" })
    .in("id", rows.map((p) => p.id));

  const finish = async (rowIds: string[], ok: boolean, errorMsg?: string) => {
    await supabase
      .from("scheduled_posts")
      .update({
        status: ok ? "posted" : "failed",
        error: ok ? null : (errorMsg ?? "Unknown error"),
        posted_at: ok ? new Date().toISOString() : null,
      })
      .in("id", rowIds);
  };

  // ── Partition: Telegram/X group together by group_id; website + others per-row ──
  const groups = new Map<string, PostRow[]>();
  const perRow: PostRow[] = [];
  for (const row of rows) {
    const groupable = row.platform === "x" || row.platform.startsWith("telegram");
    if (groupable && row.group_id) {
      const key = `${row.group_id}|${row.platform}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    } else {
      perRow.push(row);
    }
  }

  // Latest known display dimensions per asset, probed server-side by the
  // compression task. Telegram Bot API uploads don't auto-detect dims —
  // iOS/macOS render the video card from the message width/height attributes,
  // so omitting them stretches portrait videos. (See dev lesson 2026-05-28.)
  const getAssetDims = async (
    assetIds: string[],
  ): Promise<Map<string, { width: number; height: number; duration: number | null }>> => {
    const dims = new Map<string, { width: number; height: number; duration: number | null }>();
    if (!assetIds.length) return dims;
    const { data } = await supabase
      .from("compression_jobs")
      .select("asset_id, width, height, duration, created_at")
      .in("asset_id", assetIds)
      .eq("status", "done")
      .not("width", "is", null)
      .order("created_at", { ascending: false });
    for (const row of data ?? []) {
      if (!dims.has(row.asset_id)) {
        dims.set(row.asset_id, { width: row.width, height: row.height, duration: row.duration });
      }
    }
    return dims;
  };

  // ── Process a grouped (or single) Telegram/X post ────────────────────────────
  const processGroup = async (groupRows: PostRow[]) => {
    const ordered = [...groupRows].sort((a, b) => a.position - b.position);
    const platform = ordered[0].platform;
    const caption  = ordered[0].caption; // group caption lives on position 0
    const ids = ordered.map((r) => r.id);

    // Telegram videos are compressed server-side. If any are still in flight,
    // defer the whole group to the next tick (rows go back to 'pending').
    if (platform.startsWith("telegram")) {
      const videoAssetIds = [...new Set(ordered.filter((r) => r.file_type === "video").map((r) => r.asset_id))];
      if (videoAssetIds.length) {
        const { data: jobs } = await supabase
          .from("compression_jobs")
          .select("asset_id, status")
          .in("asset_id", videoAssetIds)
          .in("status", ["queued", "running"]);
        if (jobs && jobs.length) {
          await supabase.from("scheduled_posts").update({ status: "pending" }).in("id", ids);
          console.log(`[run-scheduled] Deferring telegram group — ${jobs.length} compression job(s) still running`);
          return { platform, ok: true, deferred: true, count: ids.length };
        }
      }
    }

    try {
      let result;
      if (platform === "x") {
        const items = ordered.map((r) => ({ fileUrl: r.file_url, fileType: r.file_type }));
        result = await supabase.functions.invoke("post-x", {
          body: ordered.length >= 2 ? { items, caption } : { fileUrl: ordered[0].file_url, fileType: ordered[0].file_type, caption },
        });
      } else {
        // Telegram. Always pass explicit width/height/duration for videos —
        // without them portrait videos stretch on Telegram iOS/macOS.
        const videoIds = [...new Set(ordered.filter((r) => r.file_type === "video").map((r) => r.asset_id))];
        const dimsMap = await getAssetDims(videoIds);
        const items = ordered.map((r) => {
          const d = r.file_type === "video" ? dimsMap.get(r.asset_id) : undefined;
          return {
            fileUrl: r.file_url,
            fileType: r.file_type,
            ...(d ? { width: d.width, height: d.height, ...(d.duration ? { duration: d.duration } : {}) } : {}),
          };
        });
        result = await supabase.functions.invoke("post-telegram", {
          body: ordered.length >= 2
            ? { platform, caption, items }
            : { platform, caption, ...items[0] },
        });
      }

      const ok = !result.error && result.data?.success === true;
      const errorMsg = result.error?.message ?? (result.data?.error ? String(result.data.error) : undefined);
      await finish(ids, ok, errorMsg);
      return { platform, ok, error: errorMsg, count: ids.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[run-scheduled] Group error (${platform}):`, msg);
      await finish(ids, false, msg);
      return { platform, ok: false, error: msg, count: ids.length };
    }
  };

  // ── Process a single non-groupable row (website / legacy) ────────────────────
  const processRow = async (post: PostRow) => {
    try {
      let result: { data: { success: boolean; error?: string } | null; error: { message: string } | null };

      if (post.platform === "x") {
        result = await supabase.functions.invoke("post-x", {
          body: { fileUrl: post.file_url, fileType: post.file_type, caption: post.caption },
        });
      } else if (post.platform.startsWith("telegram")) {
        const dimsMap = post.file_type === "video" ? await getAssetDims([post.asset_id]) : new Map();
        const d = dimsMap.get(post.asset_id);
        result = await supabase.functions.invoke("post-telegram", {
          body: {
            platform: post.platform,
            fileUrl: post.file_url,
            fileType: post.file_type,
            caption: post.caption,
            ...(d ? { width: d.width, height: d.height, ...(d.duration ? { duration: d.duration } : {}) } : {}),
          },
        });
      } else if (post.platform === "website") {
        const { data: compJob } = await supabase
          .from("compression_jobs")
          .select("status, compressed_url")
          .eq("asset_id", post.asset_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (compJob && (compJob.status === "queued" || compJob.status === "running")) {
          await supabase.from("scheduled_posts").update({ status: "pending" }).eq("id", post.id);
          console.log(`[run-scheduled] Deferring website post ${post.id} — compression still ${compJob.status}`);
          return { id: post.id, platform: post.platform, ok: true };
        }

        const fileUrl = compJob?.compressed_url || post.file_url;
        const wc = post.website_config ?? {};
        result = await supabase.functions.invoke("post-website", {
          body: {
            fileUrl,
            title: (wc as { title?: string }).title || post.asset_name,
            externalId: post.asset_id,
            categories: (wc as { categories?: string[] }).categories ?? [],
            tags: (wc as { tags?: string[] }).tags ?? [],
            thumbnailUrl: (wc as { thumbnailUrl?: string }).thumbnailUrl || post.asset_preview_url || "",
            caption: post.caption ?? "",
          },
        });
      } else {
        await finish([post.id], false, `Unknown platform: ${post.platform}`);
        return { id: post.id, platform: post.platform, ok: false, error: "Unknown platform" };
      }

      const ok = !result.error && result.data?.success === true;
      const errorMsg = result.error?.message ?? (result.data?.error ? String(result.data.error) : undefined);
      await finish([post.id], ok, errorMsg);
      return { id: post.id, platform: post.platform, ok, error: errorMsg };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[run-scheduled] Error posting ${post.id}:`, msg);
      await finish([post.id], false, msg);
      return { id: post.id, platform: post.platform, ok: false, error: msg };
    }
  };

  const settled = await Promise.allSettled([
    ...[...groups.values()].map(processGroup),
    ...perRow.map(processRow),
  ]);
  const results = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));

  console.log(`[run-scheduled] Processed ${results.length} posts (${groups.size} groups, ${perRow.length} singles)`);
  return new Response(
    JSON.stringify({ processed: results.length, results }),
    { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
  );
});
