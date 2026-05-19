-- Insight HR Evidence Setup
-- Run in Supabase SQL Editor. Idempotent.
-- Ensures Insight Build / HR Evidence can save trainee-level evidence rows.

begin;

create table if not exists public.app_documents (
  key text primary key,
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_documents_key
  on public.app_documents (key);

alter table public.app_documents enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'app_documents'
      and policyname = 'app_documents_select_all'
  ) then
    create policy app_documents_select_all
      on public.app_documents
      for select
      to public
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'app_documents'
      and policyname = 'app_documents_insert_all'
  ) then
    create policy app_documents_insert_all
      on public.app_documents
      for insert
      to public
      with check (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'app_documents'
      and policyname = 'app_documents_update_all'
  ) then
    create policy app_documents_update_all
      on public.app_documents
      for update
      to public
      using (true)
      with check (true);
  end if;
end $$;

insert into public.app_documents (key, content, updated_at)
values
  ('insight_hr_evidence', '[]'::jsonb, now()),
  ('insight_subject_reviews', '[]'::jsonb, now()),
  ('insight_progress_config', '{}'::jsonb, now()),
  ('insight_rule_config', '{}'::jsonb, now())
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'app_documents'
     ) then
    alter publication supabase_realtime add table public.app_documents;
  end if;
end $$;

analyze public.app_documents;

commit;
