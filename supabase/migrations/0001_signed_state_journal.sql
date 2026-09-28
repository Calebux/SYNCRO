-- Signed-state durability journal
-- Repo path: supabase/migrations/<timestamp>_signed_state_journal.sql
-- (rename with your migration tool's timestamp convention, e.g. `supabase migration new signed_state_journal`)
--
-- Why a trigger instead of application-code changes:
-- The signed state (payment_channels.channel_state) is written from multiple
-- code paths — channelStateService.persistWatchtowers,
-- channelStateService.submitWatchtowerState, and paymentChannelService's
-- applyOffChainRenewal / initiateClose / finalizeClose (not all of which are
-- visible from this file set). A trigger captures every write regardless of
-- which code path performed it, in the SAME transaction as the write itself —
-- which is what "durable before it is ever sent" actually requires. Editing
-- each call site individually would both miss paths we can't see and
-- introduce a window where the write succeeds but the journal insert fails.

create table if not exists channel_state_journal (
  id bigint generated always as identity primary key,
  channel_id uuid not null,
  user_id uuid not null,
  sequence_number bigint not null,
  channel_state jsonb not null,
  channel_row_state text not null, -- mirrors payment_channels.state at write time
  recorded_at timestamptz not null default now(),
  -- Set by the off-provider replication job (signed-state-replication-job.ts)
  -- once this row has been shipped to a second, non-Supabase location.
  replicated_at timestamptz
);

create index if not exists channel_state_journal_channel_id_idx
  on channel_state_journal (channel_id, sequence_number desc);

-- Partial index so the replication job's "find unshipped rows" query stays
-- cheap even as the journal grows into millions of rows.
create index if not exists channel_state_journal_unreplicated_idx
  on channel_state_journal (id)
  where replicated_at is null;

create or replace function log_channel_state_journal_update()
returns trigger as $$
begin
  if new.channel_state is distinct from old.channel_state then
    insert into channel_state_journal (
      channel_id, user_id, sequence_number, channel_state, channel_row_state
    ) values (
      new.id,
      new.user_id,
      coalesce((new.channel_state->>'sequenceNumber')::bigint, 0),
      new.channel_state,
      new.state
    );
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_channel_state_journal_update on payment_channels;
create trigger trg_channel_state_journal_update
  after update of channel_state on payment_channels
  for each row
  execute function log_channel_state_journal_update();

-- Also journal the initial signed state at channel creation, so a channel's
-- very first state (sequence 0) is in the journal too, not just updates.
create or replace function log_channel_state_journal_insert()
returns trigger as $$
begin
  if new.channel_state is not null then
    insert into channel_state_journal (
      channel_id, user_id, sequence_number, channel_state, channel_row_state
    ) values (
      new.id,
      new.user_id,
      coalesce((new.channel_state->>'sequenceNumber')::bigint, 0),
      new.channel_state,
      new.state
    );
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_channel_state_journal_insert on payment_channels;
create trigger trg_channel_state_journal_insert
  after insert on payment_channels
  for each row
  execute function log_channel_state_journal_insert();

-- Retention: the journal is intentionally NOT pruned by this migration.
-- Decide retention as part of the RPO/RTO doc (docs/ops/backup-restore-rpo-rto.md)
-- and add a separate scheduled delete once you've picked a window — don't
-- default to "keep forever" or "delete after 7 days" without deciding which
-- disputes/audits need to look back further than that.