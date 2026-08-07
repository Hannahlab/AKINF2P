// ==========================================================
// GENERATE REDEMPTION CODES (Supabase Edge Function)
// Only the OWNER can call this successfully — verified here,
// server-side, using their real Supabase session token.
// Deploy: supabase functions deploy generate-redemption-codes
// ==========================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function generateUniqueCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return new Response("Missing auth token", { status: 401, headers: corsHeaders });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return new Response("Invalid session", { status: 401, headers: corsHeaders });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (!profile || profile.role !== "owner") {
    return new Response("Only the owner can generate codes", { status: 403, headers: corsHeaders });
  }

  const body = await req.json().catch(() => ({}));
  const howMany = Math.min(Math.max(parseInt(String(body.count), 10) || 1, 1), 100);

  const newCodes = Array.from({ length: howMany }, () => ({
    code: generateUniqueCode(),
    code_type: "vip_unlock",
    created_by: userData.user.id,
  }));

  const { data, error } = await supabase.from("redemption_codes").insert(newCodes).select();

  if (error) {
    console.error(error);
    return new Response(JSON.stringify(error), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ codes: data }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
