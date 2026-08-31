create type user_role as enum ('owner', 'admin', 'member', 'viewer', 'user');

alter table public.profiles add column if not exists role user_role default 'user';

create index if not exists idx_profiles_role on public.profiles(role);

create or replace function public.get_user_role(user_uuid uuid)
returns user_role
language plpgsql
security definer
stable
as $$
declare
  user_role_value user_role;
begin
  select role into user_role_value
  from public.profiles
  where id = user_uuid;
  
  return coalesce(user_role_value, 'user'::user_role);
end;
$$;

grant execute on function public.get_user_role(uuid) to authenticated;
