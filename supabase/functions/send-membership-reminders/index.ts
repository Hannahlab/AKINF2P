// ==========================================================
// SEND MEMBERSHIP REMINDERS (Supabase Edge Function)
// Runs once a day via Supabase's built-in Cron Jobs (Dashboard →
// Edge Functions → your function → Cron, schedule: 0 8 * * *
// for 8am daily, or see SETUP.md).
//
// 1. Expires any membership whose period has ended.
// 2. Sends a reminder email 7 days, 3 days, and 1 day before
//    each active membership expires (each reminder only ever
//    sent once per membership, tracked in reminder_log).
// Deploy: supabase functions deploy send-membership-reminders
// ==========================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, emailWrapper } from "../_shared/email.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const REMINDER_WINDOWS = [
  { type: "7_day", daysBefore: 7 },
  { type: "3_day", daysBefore: 3 },
  { type: "1_day", daysBefore: 1 },
];

function startOfDay(d: Date) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function endOfDay(d: Date) {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

Deno.serve(async (_req) => {
  const now = new Date();

  await supabase
    .from("memberships")
    .update({ status: "expired" })
    .eq("status", "active")
    .lt("period_end", now.toISOString());

  for (const w of REMINDER_WINDOWS) {
    const target = new Date(now);
    target.setDate(target.getDate() + w.daysBefore);

    const { data: memberships, error } = await supabase
      .from("memberships")
      .select("id, user_id, period_end")
      .eq("status", "active")
      .gte("period_end", startOfDay(target).toISOString())
      .lte("period_end", endOfDay(target).toISOString());

    if (error) {
      console.error(error);
      continue;
    }

    for (const m of memberships || []) {
      const { data: existingLog } = await supabase
        .from("reminder_log")
        .select("id")
        .eq("membership_id", m.id)
        .eq("reminder_type", w.type)
        .maybeSingle();

      if (existingLog) continue;

      const { data: authUserResult } = await supabase.auth.admin.getUserById(m.user_id);
      const email = authUserResult?.user?.email;
      if (!email) continue;

      const daysLeft = w.daysBefore;
      const plural = daysLeft > 1 ? "s" : "";

      await sendEmail(
        email,
        `Your Akinf2p Pro membership expires in ${daysLeft} day${plural}`,
        emailWrapper(
          "Membership Expiring Soon",
          `<p>Your Akinf2p Pro membership expires in <strong>${daysLeft} day${plural}</strong>.</p>
           <p>Renew now to keep your VIP Lounge access and investment recommendations.</p>`
        )
      );

      await supabase.from("reminder_log").insert({ membership_id: m.id, reminder_type: w.type });
    }
  }

  return new Response("Reminders processed", { status: 200, headers: corsHeaders });
});
