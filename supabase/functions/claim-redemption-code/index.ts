// ==========================================================
// CLAIM REDEMPTION CODE (Supabase Edge Function)
// Used when a paying member enters their VIP unlock code.
// The update below only succeeds if the code is still
// unclaimed (`.is("claimed_by", null)`), which makes this
// atomic — a code can never end up shared between two accounts.
// Deploy: supabase functions deploy claim-redemption-code
// ==========================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, emailWrapper } from "../_shared/email.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const body = await req.json().catch(() => ({}));
  const code = body.code;

  if (!token || !code) {
    return new Response("Missing token or code", { status: 400, headers: corsHeaders });
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return new Response("Invalid session", { status: 401, headers: corsHeaders });
  }

  const { data, error } = await supabase
    .from("redemption_codes")
    .update({ claimed_by: userData.user.id, claimed_at: new Date().toISOString() })
    .eq("code", String(code).trim().toUpperCase())
    .is("claimed_by", null)
    .select()
    .single();

  if (error || !data) {
    return new Response(JSON.stringify({ error: "Invalid or already-used code" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // A redeemed code grants the same VIP access a paid membership
  // does — 30 days, tracked the same way, so access checks
  // everywhere only ever need to look at one thing: memberships.
  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  periodEnd.setDate(periodEnd.getDate() + 30);

  const { error: membershipError } = await supabase.from("memberships").insert({
    user_id: userData.user.id,
    status: "active",
    amount: 0,
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
  });

  if (membershipError) {
    console.error("Failed to grant membership from code:", membershipError);
    return new Response("Code claimed but activation failed — contact support", {
      status: 500,
      headers: corsHeaders,
    });
  }

  if (userData.user.email) {
    await sendEmail(
      userData.user.email,
      "VIP access activated 👑",
      emailWrapper(
        "VIP Access Unlocked",
        `<p>Your unlock code was accepted — you now have VIP Lounge access until <strong>${periodEnd.toLocaleDateString()}</strong>.</p>`
      )
    );
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
