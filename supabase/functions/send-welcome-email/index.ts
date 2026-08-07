// ==========================================================
// SEND WELCOME EMAIL (Supabase Edge Function)
// Called from the frontend immediately after a successful
// signUp() call. Not security-sensitive (just sends an email to
// whatever address is provided), so no auth check needed beyond
// basic input validation.
// Deploy: supabase functions deploy send-welcome-email --no-verify-jwt
// ==========================================================

import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, emailWrapper } from "../_shared/email.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  const body = await req.json().catch(() => ({}));
  const { email, username } = body;

  if (!email) {
    return new Response("Missing email", { status: 400, headers: corsHeaders });
  }

  await sendEmail(
    email,
    "Welcome to AKINF2P 🎉",
    emailWrapper(
      `Welcome, ${username || "there"}!`,
      `<p>Thanks for joining AKINF2P — the home of FC Mobile investors.</p>
       <p>Check your inbox for a separate verification email to confirm your address, then log in to join the community.</p>`
    )
  );

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
