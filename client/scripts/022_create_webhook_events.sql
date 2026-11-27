-- Create webhook_events table for tracking payment provider webhooks
-- This ensures idempotency and provides audit trail for webhook processing

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null, -- 'stripe', 'paypal'
  event_id text not null, -- Provider's event ID
  event_type text not null, -- Event type from provider
  event_data jsonb not null, -- Full event payload
  processed boolean default false,
  processed_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  
  -- Ensure we don't process the same event twice
  constraint webhook_events_provider_event_id_unique unique (provider, event_id)
);

-- Enable RLS
alter table public.webhook_events enable row level security;

-- RLS Policies - Only admins can view webhook events
create policy "webhook_events_admin_only"
  on public.webhook_events for all
  using (
    exists (
      select 1 from auth.users
      where auth.uid() = id
      and raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Create indexes for performance
create index idx_webhook_events_provider on public.webhook_events(provider);
create index idx_webhook_events_event_id on public.webhook_events(event_id);
create index idx_webhook_events_processed on public.webhook_events(processed);
create index idx_webhook_events_created_at on public.webhook_events(created_at);

-- Add comment
comment on table public.webhook_events is 'Stores webhook events from payment providers for idempotency and audit trail';
