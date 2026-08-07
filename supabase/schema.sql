-- ==========================================================
-- AKINF2P — SUPABASE SCHEMA (idempotent — safe to re-run)
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ==========================================================
--
-- SECURITY MODEL:
-- Anything money/role/access related (membership status,
-- redemption codes, who is admin/owner) is NEVER writable
-- directly from the browser. Those tables have no insert/update
-- policies for normal users — the only way to write to them is
-- through an Edge Function using the service_role key, which
-- lives only on Supabase's servers and bypasses Row Level
-- Security entirely (on purpose, since the function itself does
-- the real permission check).
-- ==========================================================

/* ---------------- PROFILES ---------------- */

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null,
  avatar_url text,
  role text not null default 'member' check (role in ('member', 'admin', 'owner')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "profiles_select_anon" on public.profiles;
create policy "profiles_select_anon"
  on public.profiles for select
  to anon
  using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger as $$
declare
  base_username text;
  final_username text;
  suffix int := 0;
begin
  base_username := coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1));
  final_username := base_username;

  -- If the desired username is already taken (e.g. two people signing up
  -- at the exact same moment, slipping past the frontend's availability
  -- check), auto-resolve it instead of failing the whole signup.
  while exists (select 1 from public.profiles where username = final_username) loop
    suffix := suffix + 1;
    final_username := base_username || suffix::text;
  end loop;

  insert into public.profiles (id, username)
  values (new.id, final_username)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


/* ---------------- MEMBERSHIPS ---------------- */

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'inactive' check (status in ('inactive', 'active', 'expired', 'cancelled')),
  paystack_reference text unique,
  amount numeric(10, 2),
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz not null default now()
);

alter table public.memberships enable row level security;

drop policy if exists "memberships_select_own" on public.memberships;
create policy "memberships_select_own"
  on public.memberships for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "memberships_select_admin" on public.memberships;
create policy "memberships_select_admin"
  on public.memberships for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role in ('owner', 'admin')
    )
  );

-- Deliberately no insert/update policy — only Edge Functions
-- (service_role) write here.


/* ---------------- REDEMPTION CODES ---------------- */

create table if not exists public.redemption_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  code_type text not null default 'vip_unlock' check (code_type in ('vip_unlock', 'giveaway')),
  claimed_by uuid references public.profiles (id),
  claimed_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.redemption_codes enable row level security;

drop policy if exists "redemption_codes_select_own" on public.redemption_codes;
create policy "redemption_codes_select_own"
  on public.redemption_codes for select
  to authenticated
  using (claimed_by = auth.uid());

drop policy if exists "redemption_codes_select_admin" on public.redemption_codes;
create policy "redemption_codes_select_admin"
  on public.redemption_codes for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.role in ('owner', 'admin')
    )
  );

-- No insert/update/delete policies — generation and claiming
-- both go through Edge Functions using the service_role key.


/* ---------------- CHAT MESSAGES ---------------- */

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('general', 'announcements', 'giveaways', 'vip')),
  user_id uuid not null references public.profiles (id) on delete cascade,
  text text not null,
  image_url text,
  reply_to_id uuid references public.chat_messages (id),
  created_at timestamptz not null default now()
);

alter table public.chat_messages enable row level security;

drop policy if exists "chat_select_open_channels" on public.chat_messages;
create policy "chat_select_open_channels"
  on public.chat_messages for select
  to authenticated
  using (channel in ('general', 'giveaways', 'announcements'));

-- Guests (not logged in) can view the open channels too, so
-- visitors see an active community before signing up.
drop policy if exists "chat_select_open_channels_anon" on public.chat_messages;
create policy "chat_select_open_channels_anon"
  on public.chat_messages for select
  to anon
  using (channel in ('general', 'giveaways', 'announcements'));

drop policy if exists "chat_select_vip" on public.chat_messages;
create policy "chat_select_vip"
  on public.chat_messages for select
  to authenticated
  using (
    channel = 'vip'
    and (
      exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role in ('owner', 'admin'))
      or exists (
        select 1 from public.memberships
        where memberships.user_id = auth.uid() and memberships.status = 'active' and memberships.period_end > now()
      )
    )
  );

drop policy if exists "chat_insert_open_channels" on public.chat_messages;
create policy "chat_insert_open_channels"
  on public.chat_messages for insert
  to authenticated
  with check (channel in ('general', 'giveaways') and user_id = auth.uid());

drop policy if exists "chat_insert_announcements" on public.chat_messages;
create policy "chat_insert_announcements"
  on public.chat_messages for insert
  to authenticated
  with check (
    channel = 'announcements'
    and user_id = auth.uid()
    and exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role in ('owner', 'admin'))
  );

drop policy if exists "chat_insert_vip" on public.chat_messages;
create policy "chat_insert_vip"
  on public.chat_messages for insert
  to authenticated
  with check (
    channel = 'vip'
    and user_id = auth.uid()
    and (
      exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role in ('owner', 'admin'))
      or exists (
        select 1 from public.memberships
        where memberships.user_id = auth.uid() and memberships.status = 'active' and memberships.period_end > now()
      )
    )
  );

-- Owner/admin can delete any message (chat moderation).
drop policy if exists "chat_delete_staff" on public.chat_messages;
create policy "chat_delete_staff"
  on public.chat_messages for delete
  to authenticated
  using (
    exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role in ('owner', 'admin'))
  );

-- Anyone can delete (unsend) their own message.
drop policy if exists "chat_delete_own" on public.chat_messages;
create policy "chat_delete_own"
  on public.chat_messages for delete
  to authenticated
  using (user_id = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;


/* ---------------- MESSAGE REACTIONS ---------------- */

create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);

alter table public.message_reactions enable row level security;

drop policy if exists "reactions_select_all" on public.message_reactions;
create policy "reactions_select_all"
  on public.message_reactions for select
  to authenticated
  using (true);

drop policy if exists "reactions_select_all_anon" on public.message_reactions;
create policy "reactions_select_all_anon"
  on public.message_reactions for select
  to anon
  using (true);

drop policy if exists "reactions_insert_own" on public.message_reactions;
create policy "reactions_insert_own"
  on public.message_reactions for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "reactions_update_own" on public.message_reactions;
create policy "reactions_update_own"
  on public.message_reactions for update
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "reactions_delete_own" on public.message_reactions;
create policy "reactions_delete_own"
  on public.message_reactions for delete
  to authenticated
  using (user_id = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;


/* ---------------- REMINDER LOG ---------------- */

create table if not exists public.reminder_log (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships (id) on delete cascade,
  reminder_type text not null check (reminder_type in ('7_day', '3_day', '1_day')),
  sent_at timestamptz not null default now(),
  unique (membership_id, reminder_type)
);

alter table public.reminder_log enable row level security;
-- No client policies — only the scheduled Edge Function (service_role) touches this.


/* ---------------- INVESTMENTS (owner-editable weekly picks) ---------------- */

create table if not exists public.investments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  image_url text,
  status text not null default 'coming_soon' check (status in ('coming_soon', 'active', 'sold')),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.investments enable row level security;

-- Anyone (even guests) can view picks — it's public marketing content.
drop policy if exists "investments_select_public" on public.investments;
create policy "investments_select_public"
  on public.investments for select
  to anon, authenticated
  using (true);

-- Only the owner can add/edit/remove picks.
drop policy if exists "investments_write_owner" on public.investments;
create policy "investments_write_owner"
  on public.investments for all
  to authenticated
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'owner'))
  with check (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'owner'));

do $$
begin
  if not exists (select 1 from public.investments) then
    insert into public.investments (title, description, status, sort_order) values
      ('Weekly Investment #1', 'Our first FC Mobile investment recommendation will be revealed when AKINF2P officially launches.', 'coming_soon', 1),
      ('Weekly Investment #2', 'Our first FC Mobile investment recommendation will be revealed when AKINF2P officially launches.', 'coming_soon', 2),
      ('Weekly Investment #3', 'Our first FC Mobile investment recommendation will be revealed when AKINF2P officially launches.', 'coming_soon', 3),
      ('Weekly Investment #4', 'Our first FC Mobile investment recommendation will be revealed when AKINF2P officially launches.', 'coming_soon', 4),
      ('Weekly Investment #5', 'Our first FC Mobile investment recommendation will be revealed when AKINF2P officially launches.', 'coming_soon', 5);
  end if;
end $$;


/* ---------------- MEMBERSHIP PLAN (owner-editable pricing) ---------------- */

create table if not exists public.membership_plan (
  id int primary key default 1,
  name text not null default 'Akinf2p Pro',
  price numeric(10, 2) not null default 59.99,
  features jsonb not null default '["Exclusive FC Mobile investment recommendations","Member-only investment posts","VIP Community Access","Investment Strategy Updates","Membership valid for 30 days"]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);

alter table public.membership_plan enable row level security;

-- Anyone (even guests) can see the current plan/price — it's the pricing page.
drop policy if exists "membership_plan_select_public" on public.membership_plan;
create policy "membership_plan_select_public"
  on public.membership_plan for select
  to anon, authenticated
  using (true);

-- Only the owner can change the price/name/features.
drop policy if exists "membership_plan_write_owner" on public.membership_plan;
create policy "membership_plan_write_owner"
  on public.membership_plan for all
  to authenticated
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'owner'))
  with check (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'owner'));

insert into public.membership_plan (id, name, price, features)
values (
  1,
  'Akinf2p Pro',
  59.99,
  '["Exclusive FC Mobile investment recommendations","Member-only investment posts","VIP Community Access","Investment Strategy Updates","Membership valid for 30 days"]'::jsonb
)
on conflict (id) do nothing;


/* ---------------- STORAGE: profile picture uploads ---------------- */
-- Create a bucket named "avatars" in Dashboard → Storage → set Public,
-- if you haven't already.

drop policy if exists "avatar_upload_own" on storage.objects;
create policy "avatar_upload_own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatar_update_own" on storage.objects;
create policy "avatar_update_own"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatar_read_public" on storage.objects;
create policy "avatar_read_public"
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');
