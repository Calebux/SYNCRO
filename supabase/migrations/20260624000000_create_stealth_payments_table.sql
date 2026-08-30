-- Create stealth_payments table for tracking stealth transaction payments
create table if not exists public.stealth_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_hash text not null,
  ephemeral_pubkey text not null,
  recipient_address text not null,
  amount numeric not null,
  asset text not null default 'XLM',
  timestamp timestamp with time zone not null,
  ledger integer not null default 0,
  detected_at timestamp with time zone default now(),
  created_at timestamp with time zone default now()
);

-- Enable RLS
alter table public.stealth_payments enable row level security;

-- RLS Policies for stealth_payments
create policy "stealth_payments_select_own"
  on public.stealth_payments for select
  using (auth.uid() = user_id);

create policy "stealth_payments_insert_own"
  on public.stealth_payments for insert
  with check (auth.uid() = user_id);

-- Indexes for efficient queries
create index if not exists stealth_payments_user_id_idx 
  on public.stealth_payments(user_id);

create index if not exists stealth_payments_transaction_hash_idx 
  on public.stealth_payments(transaction_hash);

create index if not exists stealth_payments_detected_at_idx 
  on public.stealth_payments(detected_at);

-- Unique constraint to prevent duplicate records for same transaction
create unique index if not exists stealth_payments_tx_hash_unique_idx 
  on public.stealth_payments(transaction_hash);
