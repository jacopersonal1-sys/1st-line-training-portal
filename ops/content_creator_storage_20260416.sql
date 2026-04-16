-- Content Creator Storage Setup (v2.6.21)
-- Run in Supabase SQL Editor (idempotent).
-- Creates/updates storage buckets and access policies used by:
-- - modules/content_studio/js/data.js (uploadVideoFile/uploadDocumentFile/resolveStorageUrl)

begin;

-- 1) Ensure buckets exist with sensible limits/mime types.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'content_creator_videos',
    'content_creator_videos',
    true,
    524288000,
    array['video/mp4','video/webm','video/quicktime','video/x-msvideo']
  ),
  (
    'content_creator_documents',
    'content_creator_documents',
    true,
    26214400,
    array['application/pdf']
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 2) Policies for videos bucket.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'content_creator_videos_select'
  ) then
    create policy content_creator_videos_select
      on storage.objects
      for select
      to public
      using (bucket_id = 'content_creator_videos');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'content_creator_videos_insert'
  ) then
    create policy content_creator_videos_insert
      on storage.objects
      for insert
      to public
      with check (bucket_id = 'content_creator_videos');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'content_creator_videos_update'
  ) then
    create policy content_creator_videos_update
      on storage.objects
      for update
      to public
      using (bucket_id = 'content_creator_videos')
      with check (bucket_id = 'content_creator_videos');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'content_creator_videos_delete'
  ) then
    create policy content_creator_videos_delete
      on storage.objects
      for delete
      to public
      using (bucket_id = 'content_creator_videos');
  end if;
end $$;

-- 3) Policies for documents bucket.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'content_creator_documents_select'
  ) then
    create policy content_creator_documents_select
      on storage.objects
      for select
      to public
      using (bucket_id = 'content_creator_documents');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'content_creator_documents_insert'
  ) then
    create policy content_creator_documents_insert
      on storage.objects
      for insert
      to public
      with check (bucket_id = 'content_creator_documents');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'content_creator_documents_update'
  ) then
    create policy content_creator_documents_update
      on storage.objects
      for update
      to public
      using (bucket_id = 'content_creator_documents')
      with check (bucket_id = 'content_creator_documents');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'content_creator_documents_delete'
  ) then
    create policy content_creator_documents_delete
      on storage.objects
      for delete
      to public
      using (bucket_id = 'content_creator_documents');
  end if;
end $$;

commit;

-- Quick verification (optional)
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('content_creator_videos', 'content_creator_documents')
order by id;
