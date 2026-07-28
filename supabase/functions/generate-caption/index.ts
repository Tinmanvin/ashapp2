/**
 * generate-caption — GPT-4o-mini caption generation.
 *
 * NOTE: this function was previously deployed (v34) with NO source in the repo
 * and verify_jwt=false, i.e. anyone on the internet could burn the OpenAI key.
 * Source recovered from the deployed version 2026-07-28 and put under version
 * control so it can be reviewed and redeployed safely.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://ashapp.atlasai-agents.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Vary": "Origin",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Signed-in users only — this spends real money per call.
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { systemPrompt, userPrompt } = await req.json();

    if (!systemPrompt || !userPrompt) {
      return new Response(
        JSON.stringify({ error: "Missing systemPrompt or userPrompt" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OpenAI key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 300,
        temperature: 0.85,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return new Response(
        JSON.stringify({ error: `OpenAI error: ${errText}` }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await response.json();
    const text = data.choices[0]?.message?.content?.trim() ?? "";

    return new Response(
      JSON.stringify({ text }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
