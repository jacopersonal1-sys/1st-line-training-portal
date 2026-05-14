-- Hosted HTML Tool Storage Setup
-- Run in Supabase SQL Editor (idempotent).
-- Creates the public bucket used by js/html_tool_hosting.js.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tool_exports',
  'tool_exports',
  true,
  52428800,
  array['text/html']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.hosted_html_tool_views (
  id bigserial primary key,
  slot text not null check (slot in ('main', 'export')),
  path text not null,
  viewed_at timestamptz not null default now(),
  referrer text,
  user_agent text,
  ip_hash text
);

create index if not exists idx_hosted_html_tool_views_slot_viewed_at
  on public.hosted_html_tool_views (slot, viewed_at desc);

alter table public.hosted_html_tool_views enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'hosted_html_tool_views'
      and policyname = 'hosted_html_tool_views_select'
  ) then
    create policy hosted_html_tool_views_select
      on public.hosted_html_tool_views
      for select
      to public
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'hosted_html_tool_views'
      and policyname = 'hosted_html_tool_views_insert'
  ) then
    create policy hosted_html_tool_views_insert
      on public.hosted_html_tool_views
      for insert
      to public
      with check (slot in ('main', 'export'));
  end if;
end $$;

do $$
begin
  drop policy if exists tool_exports_select on storage.objects;
  drop policy if exists tool_exports_insert on storage.objects;
  drop policy if exists tool_exports_update on storage.objects;
  drop policy if exists tool_exports_delete on storage.objects;

  create policy tool_exports_select
    on storage.objects
    for select
    to public
    using (bucket_id = 'tool_exports');

  create policy tool_exports_insert
    on storage.objects
    for insert
    to public
    with check (bucket_id = 'tool_exports');

  create policy tool_exports_update
    on storage.objects
    for update
    to public
    using (bucket_id = 'tool_exports')
    with check (bucket_id = 'tool_exports');

  create policy tool_exports_delete
    on storage.objects
    for delete
    to public
    using (bucket_id = 'tool_exports');
end $$;

-- Some self-hosted Supabase Storage versions infer uploaded HTML as text/plain.
-- Force hosted tool HTML objects to be served as browser-renderable HTML.
create or replace function storage.force_tool_exports_html_mimetype()
returns trigger
language plpgsql
as $$
begin
  if new.bucket_id = 'tool_exports' and lower(new.name) like '%.html' then
    new.metadata = jsonb_set(
      coalesce(new.metadata, '{}'::jsonb),
      '{mimetype}',
      '"text/html"'::jsonb,
      true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists force_tool_exports_html_mimetype on storage.objects;

create trigger force_tool_exports_html_mimetype
before insert or update on storage.objects
for each row
execute function storage.force_tool_exports_html_mimetype();

update storage.objects
set metadata = jsonb_set(
  coalesce(metadata, '{}'::jsonb),
  '{mimetype}',
  '"text/html"'::jsonb,
  true
)
where bucket_id = 'tool_exports'
  and lower(name) like '%.html';

commit;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'tool_exports';
