-- Minimal Supabase SQL Editor version.
-- Run STEP 1 first. If it succeeds, run STEP 2.

-- STEP 1: Create the row tables and indexes.
create table if not exists public.assessment_studio_submissions (
    id text primary key,
    trainee text,
    assessment text,
    status text,
    data jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

create index if not exists idx_assessment_studio_submissions_trainee
    on public.assessment_studio_submissions (trainee);

create index if not exists idx_assessment_studio_submissions_status
    on public.assessment_studio_submissions (status);

create index if not exists idx_assessment_studio_submissions_updated_at
    on public.assessment_studio_submissions (updated_at);

create table if not exists public.violation_reports (
    id text primary key,
    trainee text,
    status text,
    data jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

create index if not exists idx_violation_reports_trainee
    on public.violation_reports (trainee);

create index if not exists idx_violation_reports_status
    on public.violation_reports (status);

create index if not exists idx_violation_reports_updated_at
    on public.violation_reports (updated_at);

-- STEP 2: Grant API roles access. Run after STEP 1 succeeds.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.assessment_studio_submissions to anon, authenticated;
grant select, insert, update, delete on public.violation_reports to anon, authenticated;
