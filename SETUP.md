# AKINF2P — Setup Guide (GitHub Pages + Supabase Edge Functions)

## What was actually broken (read this first)

1. **Black screen.** Your `index.html`'s account modal `<div>`s were never
   properly closed — the header, hero, and footer had all become nested
   *inside* the hidden modal box. Since the modal is `display:none` by
   default, everything nested inside it was invisible. Fixed by rebuilding
   the modal with matching open/close tags.
2. **"Identifier already declared" errors.** Your `auth.js` declared
   `loginBtn` and `signupBtn` with `const` twice in the same file — an
   illegal redeclaration that throws a `SyntaxError` and stops the entire
   file (and everything depending on it) from running. Rewritten with each
   variable declared once.
3. Several pages (`investments.html`, `vip.html`, `community.html`) never
   actually had the Supabase/auth `<script>` tags added, so login did
   nothing on those pages even once `index.html` was fixed.

## 1. Project structure (lightly reorganized)

```
/
├── index.html, investments.html, vip.html, community.html
├── dashboard.html      (user dashboard)
├── owner.html          (owner dashboard — only visible to your account)
├── css/                (style.css, features.css, community.css, dashboard.css)
├── js/                 (supabase.js, auth.js, script.js, community.js,
│                        features.js, payment.js, dashboard.js, owner.js)
├── assets/avatars/default-avatar.png
├── supabase/
│   ├── schema.sql
│   └── functions/      (Edge Functions — NOT part of the deployed site,
│                        these get deployed separately to Supabase, see below)
├── robots.txt
└── sitemap.xml
```

**Why I didn't move `dashboard.html`/`owner.html` into their own folders**
(e.g. `dashboard/index.html`): GitHub Pages project sites are served under
a sub-path, and every single relative link/script/CSS path across every
page would need adjusting to add `../`. That's a lot of surface area for a
one-character mistake to break the whole site again. I kept these at root
for now since functionality mattered more this round — happy to do that
move as a separate, focused pass once everything's confirmed working.

## 2. Database — run this in Supabase

**SQL Editor → New Query** → paste all of `supabase/schema.sql` → Run.
This is safe to run even though you already have `profiles`/`memberships`
tables — every statement either uses `if not exists` or drops-then-recreates
policies, so it won't error on things that already exist.

**Set yourself as owner** (there's no UI for this — has to be first-time
manual): sign up on the live site normally first, then in SQL Editor run:

```sql
update public.profiles set role = 'owner' where username = 'YOUR_USERNAME';
```

## 3. Deploy the Edge Functions

Install the Supabase CLI if you haven't: `npm install -g supabase`

From your project folder:

```bash
supabase login
supabase link --project-ref aegjuqehdmkpmliiuvug

supabase functions deploy initiate-payment
supabase functions deploy generate-redemption-codes
supabase functions deploy claim-redemption-code
supabase functions deploy set-user-role
supabase functions deploy send-membership-reminders
supabase functions deploy send-welcome-email --no-verify-jwt
supabase functions deploy paystack-webhook --no-verify-jwt
```

The last two use `--no-verify-jwt` because Paystack and your own signup
flow call them without a logged-in user's Supabase session — they're
protected a different way instead (Paystack via its signature header,
welcome-email has nothing sensitive in it).

## 4. Set secrets for the Edge Functions

```bash
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxxxx
supabase secrets set PAYSTACK_CALLBACK_URL=https://yourusername.github.io/your-repo/vip.html
supabase secrets set RESEND_API_KEY=re_xxxxx
supabase secrets set RESEND_FROM_ADDRESS="AKINF2P <memberships@yourdomain.com>"
```

(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are already available to
every Edge Function automatically — no need to set those yourself.)

## 5. Paystack webhook

Paystack dashboard → Settings → API Keys & Webhooks → Webhook URL:

```
https://aegjuqehdmkpmliiuvug.supabase.co/functions/v1/paystack-webhook
```

## 6. Schedule the reminder emails

Supabase Dashboard → Edge Functions → `send-membership-reminders` → there's
a **Cron** tab — set it to run daily, e.g. `0 8 * * *` (8am UTC daily).

## 7. Resend

Sign up at resend.com → verify your sending domain (adds a couple of DNS
records) → grab your API key for step 4 above. Until your domain is
verified you can test with Resend's sandbox sender address.

Supabase Auth already sends its own signup-verification and
password-reset emails automatically — you don't need to build those
yourself. The custom emails I wired up (welcome, payment receipt, VIP
activated, expiry reminders) are separate and go through Resend as above.

## 8. What each protected page actually does

- `dashboard.html` — shows a "please log in" card if you're not logged in.
- `owner.html` — shows "not accessible" unless your profile's `role` is
  `owner`.
- VIP Lounge (inside `community.html`) — only renders chat if you have an
  active membership or are staff; otherwise shows the locked card with a
  code-redemption box.

**Important nuance:** these page-level checks are just UX — they hide
content so guests don't see a broken/empty page. The **real** security is
the Row Level Security policies in `schema.sql`, which enforce the same
rules directly in the database no matter what the page's JavaScript does.
That's what actually stops someone from reading VIP messages by, say,
calling the Supabase API directly instead of clicking around your site.

One thing I did **not** change: the header **VIP nav link** still goes
straight to `vip.html` for everyone, unlocked — that's the same
"don't gate the pricing page, only the chat room" behavior from earlier in
this project, since it directly conflicts with request #14 saying guests
shouldn't see `vip.html` at all. Let me know which you actually want and
I'll adjust.

## 9. New this round: investments, password reset

- **Investments are now database-driven.** `schema.sql` was updated with an
  `investments` table (seeded with your original 5 "Coming Soon" cards).
  Re-run the whole `schema.sql` file again — it's idempotent, safe to re-run.
  Manage picks from `owner.html` → Investment Picks (add/delete; the
  investments page pulls live from the table via `js/investments.js`).
- **Password reset works now.** "Forgot password?" on the login form sends
  Supabase's built-in reset email, which links to the new
  `reset-password.html` page to set a new password.

## 10. Still not done

- **Investment management UI** in the owner dashboard — right now the
  weekly picks on `investments.html` are static content in the HTML, not
  database-driven. Turning that into an editable CMS-style section is a
  separate chunk of work (new table + RLS + owner UI) I haven't built yet.
- **Password reset flow UI** — Supabase sends the email automatically, but
  there's no "reset password" page on your site yet to handle the reset
  link and set a new password.
- Full analytics beyond the 4 basic counters in the owner dashboard
  (signups over time, revenue over time, etc.) would need either more
  queries or a proper analytics table.

Tell me which of these matters most and I'll pick it up next.
