-- BuildZone row-storage relief for Assessment Studio submissions and violation reports.
-- Run this before enabling the row-backed fast path on production clients.

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

alter table public.assessment_studio_submissions enable row level security;
alter table public.violation_reports enable row level security;

drop policy if exists "Allow assessment studio submission sync"
    on public.assessment_studio_submissions;

create policy "Allow assessment studio submission sync"
    on public.assessment_studio_submissions
    for all
    using (true)
    with check (true);

drop policy if exists "Allow violation report sync"
    on public.violation_reports;

create policy "Allow violation report sync"
    on public.violation_reports
    for all
    using (true)
    with check (true);

analyze public.assessment_studio_submissions;
analyze public.violation_reports;
