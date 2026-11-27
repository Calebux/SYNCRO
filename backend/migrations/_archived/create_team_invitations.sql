-- Team invitations table for pending member invites
create table if not exists public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'member', 'viewer')),
  token uuid not null unique default gen_random_uuid(),
  invited_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamp with time zone not null default (now() + interval '7 days'),
  accepted_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

-- Indexes
create index if not exists team_invitations_token_idx on public.team_invitations(token);
create index if not exists team_invitations_team_id_idx on public.team_invitations(team_id);
create index if not exists team_invitations_email_idx on public.team_invitations(email);
