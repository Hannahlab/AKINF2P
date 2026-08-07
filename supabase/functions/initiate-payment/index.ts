// ==========================================================
// INITIATE PAYMENT (Supabase Edge Function)
// Deploy: supabase functions deploy initiate-payment
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

  try {
    const { email, user_id } = await req.json();

    if (!email || !user_id) {
      return new Response("Missing email or user_id", { status: 400, headers: corsHeaders });
    }

    // Read the CURRENT price the owner has set — never trust a price
    // passed from the frontend, always look it up server-side so the
    // owner dashboard's price is what actually gets charged.
    const { data: plan } = await supabase
      .from("membership_plan")
      .select("price")
      .eq("id", 1)
      .single();

    const priceInRand = plan ? Number(plan.price) : 59.99; // fallback if the row is ever missing
    const amountInCents = Math.round(priceInRand * 100);

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("PAYSTACK_SECRET_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: amountInCents,
        currency: "ZAR",
        metadata: { user_id },
        callback_url: Deno.env.get("PAYSTACK_CALLBACK_URL"),
      }),
    });

    const result = await response.json();

    if (!result.status) {
      return new Response(JSON.stringify(result), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ authorization_url: result.data.authorization_url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
