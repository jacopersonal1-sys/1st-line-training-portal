-- Protect recovered Assessment Studio authoring data from stale clients.
-- This trigger preserves existing Question Bucket / generator / grouping / tag arrays
-- when an update tries to replace them with an empty authoring payload.

create or replace function public.protect_assessment_studio_authoring()
returns trigger
language plpgsql
security definer
as $$
declare
    old_has_authoring boolean;
    new_authoring_empty boolean;
begin
    if coalesce(new.key, old.key) <> 'assessment_studio_data' then
        return new;
    end if;

    old_has_authoring :=
        jsonb_array_length(coalesce(old.content->'questionBucket', '[]'::jsonb)) > 0
        or jsonb_array_length(coalesce(old.content->'generators', '[]'::jsonb)) > 0
        or jsonb_array_length(coalesce(old.content->'groupings', '[]'::jsonb)) > 0
        or jsonb_array_length(coalesce(old.content->'tags', '[]'::jsonb)) > 0;

    new_authoring_empty :=
        jsonb_array_length(coalesce(new.content->'questionBucket', '[]'::jsonb)) = 0
        and jsonb_array_length(coalesce(new.content->'generators', '[]'::jsonb)) = 0
        and jsonb_array_length(coalesce(new.content->'groupings', '[]'::jsonb)) = 0
        and jsonb_array_length(coalesce(new.content->'tags', '[]'::jsonb)) = 0;

    if old_has_authoring and new_authoring_empty then
        new.content := new.content || jsonb_build_object(
            'questionBucket', coalesce(old.content->'questionBucket', '[]'::jsonb),
            'generators', coalesce(old.content->'generators', '[]'::jsonb),
            'groupings', coalesce(old.content->'groupings', '[]'::jsonb),
            'tags', coalesce(old.content->'tags', '[]'::jsonb),
            'updatedBy', coalesce(new.content->>'updatedBy', 'Server Authoring Guard')
        );
    end if;

    return new;
end;
$$;

drop trigger if exists protect_assessment_studio_authoring_update
    on public.app_documents;

create trigger protect_assessment_studio_authoring_update
before update of content on public.app_documents
for each row
when (old.key = 'assessment_studio_data')
execute function public.protect_assessment_studio_authoring();
