import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "https://ashapp.atlasai-agents.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Vary": "Origin",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { fileUrl, assetId, rowIds = [] } = await req.json() as {
      fileUrl: string;
      assetId: string;
      rowIds?: string[];
    };

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Create the job row — task will update it as it progresses
    const { data: job, error: jobErr } = await supabase
      .from("compression_jobs")
      // owner_id required — compression_jobs is owner-scoped by RLS now.
      .insert({ asset_id: assetId, row_ids: rowIds, status: "queued", progress: 0, owner_id: auth.userId })
      .select("id")
      .single();

    if (jobErr || !job) {
      throw new Error(`Failed to create job: ${jobErr?.message}`);
    }

    const jobId = job.id;

    // Trigger the Trigger.dev task via REST API
    const triggerKey = Deno.env.get("TRIGGER_SECRET_KEY")!;
    const triggerRes = await fetch(
      "https://api.trigger.dev/api/v1/tasks/compress-for-website/trigger",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${triggerKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          payload: { fileUrl, assetId, jobId, rowIds },
        }),
      },
    );

    const triggerBody = await triggerRes.text();
    if (!triggerRes.ok) {
      await supabase.from("compression_jobs").update({ status: "failed", error: triggerBody }).eq("id", jobId);
      throw new Error(`Trigger.dev API failed (${triggerRes.status}): ${triggerBody}`);
    }

    console.log(`[trigger-compress-website] Enqueued job ${jobId} for asset ${assetId}`, triggerBody);

    return new Response(JSON.stringify({ jobId }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[trigger-compress-website] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
