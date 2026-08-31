-- Create reminder_schedules table to track scheduled reminders
create table if not exists public.reminder_schedules (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_date date not null,
  reminder_type text not null check (reminder_type in ('renewal', 'trial_expiry', 'cancellation')),
  days_before integer not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.reminder_schedules enable row level security;

-- RLS Policies
create policy "reminder_schedules_select_own"
  on public.reminder_schedules for select
  using (auth.uid() = user_id);

create policy "reminder_schedules_insert_own"
  on public.reminder_schedules for insert
  with check (auth.uid() = user_id);

create policy "reminder_schedules_update_own"
  on public.reminder_schedules for update
  using (auth.uid() = user_id);

-- Indexes
create index if not exists reminder_schedules_user_id_idx on public.reminder_schedules(user_id);
create index if not exists reminder_schedules_subscription_id_idx on public.reminder_schedules(subscription_id);
create index if not exists reminder_schedules_reminder_date_idx on public.reminder_schedules(reminder_date);
create index if not exists reminder_schedules_status_idx on public.reminder_schedules(status);

-- Create notification_deliveries table to track delivery attempts
create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  reminder_schedule_id uuid not null references public.reminder_schedules(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('email', 'push', 'slack')),
  status text not null check (status in ('pending', 'sent', 'failed', 'retrying')),
  attempt_count integer default 0,
  max_attempts integer default 3,
  last_attempt_at timestamp with time zone,
  next_retry_at timestamp with time zone,
  error_message text,
  metadata jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.notification_deliveries enable row level security;

-- RLS Policies
create policy "notification_deliveries_select_own"
  on public.notification_deliveries for select
  using (auth.uid() = user_id);

create policy "notification_deliveries_insert_own"
  on public.notification_deliveries for insert
  with check (auth.uid() = user_id);

create policy "notification_deliveries_update_own"
  on public.notification_deliveries for update
  using (auth.uid() = user_id);

-- Indexes
create index if not exists notification_deliveries_reminder_schedule_id_idx on public.notification_deliveries(reminder_schedule_id);
create index if not exists notification_deliveries_user_id_idx on public.notification_deliveries(user_id);
create index if not exists notification_deliveries_status_idx on public.notification_deliveries(status);
create index if not exists notification_deliveries_next_retry_at_idx on public.notification_deliveries(next_retry_at);

-- Create blockchain_logs table to track on-chain events
create table if not exists public.blockchain_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  event_data jsonb not null,
  transaction_hash text,
  block_number text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'failed')),
  error_message text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.blockchain_logs enable row level security;

-- RLS Policies
create policy "blockchain_logs_select_own"
  on public.blockchain_logs for select
  using (auth.uid() = user_id);

create policy "blockchain_logs_insert_own"
  on public.blockchain_logs for insert
  with check (auth.uid() = user_id);

-- Indexes
create index if not exists blockchain_logs_user_id_idx on public.blockchain_logs(user_id);
create index if not exists blockchain_logs_event_type_idx on public.blockchain_logs(event_type);
create index if not exists blockchain_logs_status_idx on public.blockchain_logs(status);
create index if not exists blockchain_logs_transaction_hash_idx on public.blockchain_logs(transaction_hash);
