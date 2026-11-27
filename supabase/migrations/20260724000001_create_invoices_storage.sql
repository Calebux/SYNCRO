-- Managing PDF Invoices via Supabase Storage (issue #298)
--
-- Adds a private `invoices` storage bucket plus a metadata table so users can
-- upload invoice PDFs (or have them extracted from emails) and later view them
-- through short-lived signed URLs. Objects are namespaced per user
-- (`<user_id>/<uuid>.pdf`) and both the table and the storage objects are
-- locked down with row-level security so a user can only ever reach their own
-- invoices.

-- ─── Storage bucket ────────────────────────────────────────────────────────────
-- Private bucket (public = false); access is only ever granted via signed URLs.
-- 10 MB per-object limit, PDFs only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

-- ─── Metadata table ────────────────────────────────────────────────────────────
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  payment_id text,
  storage_path text not null,
  file_name text not null,
  content_type text not null default 'application/pdf',
  size_bytes bigint not null default 0,
  -- Where the invoice came from: a direct upload or an email extraction.
  source text not null default 'upload' check (source in ('upload', 'email')),
  created_at timestamp with time zone default now()
);

alter table public.invoices enable row level security;

-- Users may only read/insert/delete their own invoice rows.
create policy "invoices_select_own"
  on public.invoices for select
  using (auth.uid() = user_id);

create policy "invoices_insert_own"
  on public.invoices for insert
  with check (auth.uid() = user_id);

create policy "invoices_delete_own"
  on public.invoices for delete
  using (auth.uid() = user_id);

create index if not exists invoices_user_id_idx on public.invoices(user_id);
create index if not exists invoices_subscription_id_idx on public.invoices(subscription_id);
create index if not exists invoices_created_at_idx on public.invoices(created_at desc);

-- One row per stored object.
create unique index if not exists invoices_storage_path_unique_idx
  on public.invoices(storage_path);

-- ─── Storage object policies ───────────────────────────────────────────────────
-- Restrict every operation on objects in the `invoices` bucket to the owning
-- user's folder. The first path segment must equal the caller's uid, e.g.
-- `<user_id>/<uuid>.pdf`.
create policy "invoices_objects_select_own"
  on storage.objects for select
  using (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "invoices_objects_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "invoices_objects_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
