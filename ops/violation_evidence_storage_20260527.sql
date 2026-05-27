-- Violation Evidence Storage Setup (v2.7.4)
-- Run in Supabase SQL Editor before releasing the Activity Monitor evidence update.
--
-- The app stores violation report explanations in the existing violation_reports blob,
-- but screenshot binaries are uploaded to this private bucket and referenced by path.
-- Existing clients use the Supabase anon key, so these policies are bucket-scoped and
-- app-enforced. For true database-enforced admin-only access, move evidence retrieval
-- behind Supabase Auth admin claims or a service-role API/Edge Function.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'violation_evidence',
  'violation_evidence',
  false,
  10485760,
  array['image/jpeg','image/png']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.violation_evidence (
  id text primary key,
  report_id text not null,
  trainee text not null,
  screen_index integer not null default 0,
  bucket text not null default 'violation_evidence',
  path text not null,
  mime text not null default 'image/jpeg',
  width integer,
  height integer,
  size_bytes integer,
  captured_at timestamptz not null default now(),
  status text not null default 'active',
  reviewed_at timestamptz,
  reviewed_by text,
  deleted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint violation_evidence_status_check check (status in ('active','deleted'))
);

create index if not exists idx_violation_evidence_report_id
  on public.violation_evidence (report_id);

create index if not exists idx_violation_evidence_trainee_captured
  on public.violation_evidence (trainee, captured_at desc);

create index if not exists idx_violation_evidence_status
  on public.violation_evidence (status);

alter table public.violation_evidence enable row level security;

do $$
begin
  drop policy if exists violation_evidence_select on public.violation_evidence;
  drop policy if exists violation_evidence_insert on public.violation_evidence;
  drop policy if exists violation_evidence_update on public.violation_evidence;
  drop policy if exists violation_evidence_delete on public.violation_evidence;

  create policy violation_evidence_select
    on public.violation_evidence
    for select
    to public
    using (true);

  create policy violation_evidence_insert
    on public.violation_evidence
    for insert
    to public
    with check (bucket = 'violation_evidence');

  create policy violation_evidence_update
    on public.violation_evidence
    for update
    to public
    using (bucket = 'violation_evidence')
    with check (bucket = 'violation_evidence');

  create policy violation_evidence_delete
    on public.violation_evidence
    for delete
    to public
    using (bucket = 'violation_evidence');
end $$;

do $$
begin
  drop policy if exists violation_evidence_storage_select on storage.objects;
  drop policy if exists violation_evidence_storage_insert on storage.objects;
  drop policy if exists violation_evidence_storage_update on storage.objects;
  drop policy if exists violation_evidence_storage_delete on storage.objects;

  create policy violation_evidence_storage_select
    on storage.objects
    for select
    to public
    using (bucket_id = 'violation_evidence');

  create policy violation_evidence_storage_insert
    on storage.objects
    for insert
    to public
    with check (bucket_id = 'violation_evidence');

  create policy violation_evidence_storage_update
    on storage.objects
    for update
    to public
    using (bucket_id = 'violation_evidence')
    with check (bucket_id = 'violation_evidence');

  create policy violation_evidence_storage_delete
    on storage.objects
    for delete
    to public
    using (bucket_id = 'violation_evidence');
end $$;

commit;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'violation_evidence';

select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename = 'violation_evidence';
