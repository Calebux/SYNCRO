create table if not exists csp_violations (
  id uuid primary key default gen_random_uuid(),
  violated_directive text not null,
  blocked_uri text,
  document_uri text,
  disposition text,
  created_at timestamptz not null default now()
);

create index on csp_violations (violated_directive);
create index on csp_violations (created_at);
