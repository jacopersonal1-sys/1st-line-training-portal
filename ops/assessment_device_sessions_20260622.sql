-- Device-backed assessment sessions.
-- Run once before enabling Admin Tools > Device Sessions.
--
-- This self-hosted Supabase install has returned wrapper errors on policy/grant
-- batches even when the SQL is valid, so keep this setup deliberately minimal:
-- create the table, keep RLS disabled for the app's anon-key runtime, grant the
-- required access, and reload PostgREST's schema cache.

create table if not exists public.assessment_device_sessions (
    id text primary key,
    assessment_type text not null check (assessment_type in ('test_engine', 'assessment_studio')),
    assessment_id text not null,
    assessment_title text,
    slot_number integer not null check (slot_number between 1 and 4),
    client_code text,
    mac_address text,
    pppoe_name text,
    status text not null default 'available' check (status in ('available', 'in_use', 'requires_attention', 'offline')),
    claimed_by text,
    claimed_at timestamptz,
    claimed_submission_id text,
    updated_at timestamptz not null default now()
);

create unique index if not exists assessment_device_sessions_assessment_slot_idx
    on public.assessment_device_sessions (assessment_type, assessment_id, slot_number);

create index if not exists assessment_device_sessions_status_idx
    on public.assessment_device_sessions (assessment_type, assessment_id, status);

alter table public.assessment_device_sessions disable row level security;

grant select, insert, update, delete on public.assessment_device_sessions to anon, authenticated;

notify pgrst, 'reload schema';

analyze public.assessment_device_sessions;
