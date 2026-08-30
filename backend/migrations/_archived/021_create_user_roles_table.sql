-- Create user_roles table for authoritative role storage
-- This replaces the user_metadata.role fallback logic

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  assigned_by uuid references auth.users(id),
  assigned_at timestamp with time zone default now(),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Indexes for performance
create index if not exists user_roles_role_idx on public.user_roles(role);
create index if not exists user_roles_assigned_by_idx on public.user_roles(assigned_by);

-- Enable RLS
alter table public.user_roles enable row level security;

-- RLS Policies
-- Users can read their own role
create policy "user_roles_select_own"
  on public.user_roles for select
  using (auth.uid() = user_id);

-- Only admins/owners can read all roles (for management)
create policy "user_roles_select_admin"
  on public.user_roles for select
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
      and ur.role in ('owner', 'admin')
    )
  );

-- Only admins/owners can insert/update roles
create policy "user_roles_insert_admin"
  on public.user_roles for insert
  with check (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
      and ur.role in ('owner', 'admin')
    )
  );

create policy "user_roles_update_admin"
  on public.user_roles for update
  using (
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
      and ur.role in ('owner', 'admin')
    )
  );

-- Trigger for updated_at
create or replace function public.handle_user_roles_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_user_roles_updated_at
  before update on public.user_roles
  for each row
  execute function public.handle_user_roles_updated_at();

-- Function to get user role (authoritative source)
create or replace function public.get_user_role(user_uuid uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  user_role text;
begin
  select role into user_role
  from public.user_roles
  where user_id = user_uuid;

  -- Return role if found, otherwise default to 'member'
  return coalesce(user_role, 'member');
end;
$$;

-- Migrate existing user_metadata roles to the new table
-- This ensures backward compatibility
insert into public.user_roles (user_id, role, assigned_by, assigned_at)
select
  u.id,
  case
    when u.raw_user_meta_data ->> 'role' in ('owner', 'admin', 'member', 'viewer')
    then u.raw_user_meta_data ->> 'role'
    else 'member'
  end,
  null, -- assigned_by is null for migrated roles
  now()
from auth.users u
left join public.user_roles ur on ur.user_id = u.id
where ur.user_id is null
  and u.raw_user_meta_data ->> 'role' is not null;

-- Create default roles for users without any role
insert into public.user_roles (user_id, role, assigned_by, assigned_at)
select
  u.id,
  'member',
  null,
  now()
from auth.users u
left join public.user_roles ur on ur.user_id = u.id
where ur.user_id is null
on conflict (user_id) do nothing;