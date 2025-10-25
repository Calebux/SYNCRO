-- Create profiles table
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  company_name text,
  currency text default 'USD',
  timezone text default 'UTC',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- Create email_accounts table
create table if not exists public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  email text not null,
  provider text not null,
  is_connected boolean default true,
  last_scanned_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.email_accounts enable row level security;

create policy "email_accounts_select_own"
  on public.email_accounts for select
  using (auth.uid() = user_id);

create policy "email_accounts_insert_own"
  on public.email_accounts for insert
  with check (auth.uid() = user_id);

create policy "email_accounts_update_own"
  on public.email_accounts for update
  using (auth.uid() = user_id);

create policy "email_accounts_delete_own"
  on public.email_accounts for delete
  using (auth.uid() = user_id);

-- Create subscriptions table
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  category text not null,
  price numeric not null,
  icon text,
  renews_in integer,
  status text not null default 'active',
  color text,
  renewal_url text,
  tags text[],
  date_added timestamp with time zone default timezone('utc'::text, now()) not null,
  email_account_id uuid references public.email_accounts(id) on delete set null,
  last_used_at timestamp with time zone,
  has_api_key boolean default false,
  is_trial boolean default false,
  trial_ends_at timestamp with time zone,
  price_after_trial numeric,
  source text default 'manual',
  manually_edited boolean default false,
  edited_fields text[],
  pricing_type text default 'fixed',
  billing_cycle text default 'monthly',
  cancelled_at timestamp with time zone,
  active_until timestamp with time zone,
  paused_at timestamp with time zone,
  resumes_at timestamp with time zone,
  price_range jsonb,
  price_history jsonb default '[]'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.subscriptions enable row level security;

create policy "subscriptions_select_own"
  on public.subscriptions for select
  using (auth.uid() = user_id);

create policy "subscriptions_insert_own"
  on public.subscriptions for insert
  with check (auth.uid() = user_id);

create policy "subscriptions_update_own"
  on public.subscriptions for update
  using (auth.uid() = user_id);

create policy "subscriptions_delete_own"
  on public.subscriptions for delete
  using (auth.uid() = user_id);

-- Create team_members table
create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  email text not null,
  role text not null,
  department text,
  avatar text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.team_members enable row level security;

create policy "team_members_select_own"
  on public.team_members for select
  using (auth.uid() = user_id);

create policy "team_members_insert_own"
  on public.team_members for insert
  with check (auth.uid() = user_id);

create policy "team_members_update_own"
  on public.team_members for update
  using (auth.uid() = user_id);

create policy "team_members_delete_own"
  on public.team_members for delete
  using (auth.uid() = user_id);

-- Create notifications table
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  type text not null,
  title text not null,
  message text not null,
  subscription_id uuid references public.subscriptions(id) on delete cascade,
  is_read boolean default false,
  action_taken boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.notifications enable row level security;

create policy "notifications_select_own"
  on public.notifications for select
  using (auth.uid() = user_id);

create policy "notifications_insert_own"
  on public.notifications for insert
  with check (auth.uid() = user_id);

create policy "notifications_update_own"
  on public.notifications for update
  using (auth.uid() = user_id);

create policy "notifications_delete_own"
  on public.notifications for delete
  using (auth.uid() = user_id);
