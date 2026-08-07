// ==========================================================
// SET USER ROLE (Supabase Edge Function)
// Lets the OWNER promote a member to admin, or demote an admin
// back to member. Admins can never call this successfully, so
// admins can only ever have chat-moderation powers, never the
// ability to create more admins.
// Deploy: supabase functions deploy set-user-role
// ==========================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

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
  const targetUserId = body.target_user_id;
  const newRole = body.new_role;

  if (!token || !targetUserId || !["member", "admin"].includes(newRole)) {
    return new Response("Missing or invalid fields", { status: 400, headers: corsHeaders });
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return new Response("Invalid session", { status: 401, headers: corsHeaders });
  }

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (!callerProfile || callerProfile.role !== "owner") {
    return new Response("Only the owner can change roles", { status: 403, headers: corsHeaders });
  }

  const { data: targetProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", targetUserId)
    .single();

  if (targetProfile && targetProfile.role === "owner") {
    return new Response("Cannot change the owner's role", { status: 400, headers: corsHeaders });
  }

  const { error } = await supabase.from("profiles").update({ role: newRole }).eq("id", targetUserId);

  if (error) {
    return new Response(JSON.stringify(error), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
