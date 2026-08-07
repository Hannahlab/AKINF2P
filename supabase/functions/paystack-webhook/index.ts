// ==========================================================
// PAYSTACK WEBHOOK (Supabase Edge Function)
// Paystack calls this URL automatically after a payment.
// Deploy: supabase functions deploy paystack-webhook --no-verify-jwt
// (--no-verify-jwt because Paystack calls this directly, not with
// a Supabase user session — we verify it a different way below:
// checking Paystack's own HMAC signature.)
// Then set this as your webhook URL in the Paystack dashboard:
// https://<project-ref>.supabase.co/functions/v1/paystack-webhook
// ==========================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, emailWrapper } from "../_shared/email.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function hmacSha512Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature") || "";
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY")!;

  const expectedHash = await hmacSha512Hex(secret, rawBody);

  if (expectedHash !== signature) {
    return new Response("Invalid signature", { status: 401, headers: corsHeaders });
  }

  const payload = JSON.parse(rawBody);

  if (payload.event !== "charge.success") {
    return new Response("Ignored", { status: 200, headers: corsHeaders });
  }

  const data = payload.data;
  const reference = data.reference;
  const amount = data.amount / 100; // Paystack sends amount in cents
  const userId = data.metadata?.user_id;
  const email = data.customer?.email;

  if (!userId) {
    return new Response("Missing user_id in payment metadata", { status: 400, headers: corsHeaders });
  }

  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  periodEnd.setDate(periodEnd.getDate() + 30);

  const { error } = await supabase.from("memberships").insert({
    user_id: userId,
    status: "active",
    paystack_reference: reference,
    amount,
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
  });

  if (error) {
    console.error("Failed to record membership:", error);
    return new Response("Database error", { status: 500, headers: corsHeaders });
  }

  if (email) {
    await sendEmail(
      email,
      "Payment received — Akinf2p Pro activated",
      emailWrapper(
        "Payment Confirmed ✅",
        `<p>We received your payment of <strong>R${amount.toFixed(2)}</strong>.</p>
         <p>Your Akinf2p Pro membership is now active until <strong>${periodEnd.toLocaleDateString()}</strong>.</p>
         <p>Head to the VIP Lounge in Community to start chatting with other Pro members.</p>`
      )
    );
  }

  return new Response("OK", { status: 200, headers: corsHeaders });
});
