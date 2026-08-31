-- Create reminder_settings table
create table if not exists public.reminder_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reminder_days_before integer[] not null default '{7, 3, 1}',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.reminder_settings enable row level security;

-- RLS Policies
create policy "reminder_settings_select_own"
  on public.reminder_settings for select
  using (auth.uid() = user_id);

create policy "reminder_settings_insert_own"
  on public.reminder_settings for insert
  with check (auth.uid() = user_id);

create policy "reminder_settings_update_own"
  on public.reminder_settings for update
  using (auth.uid() = user_id);

-- Trigger for updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at_reminder_settings
  before update on public.reminder_settings
  for each row
  execute function public.handle_updated_at();

-- Add default settings for existing users
insert into public.reminder_settings (user_id)
select id from auth.users
on conflict (user_id) do nothing;